//! 内置服务端进程管理：启动 node.exe 运行 oa-server.mjs，健康检查、意外退出检测与优雅退出。

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::win::{simplify_path, Job, CREATE_NO_WINDOW};

/// 与 server/desktop/main.ts 约定：端口被占用时以该退出码退出
const EXIT_PORT_IN_USE: i32 = 98;
const START_TIMEOUT: Duration = Duration::from_secs(120);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Stopped,
    Starting,
    Running,
    Error,
}

#[derive(Serialize, Clone, Debug)]
pub struct Address {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub status: Status,
    pub port: u16,
    pub lan: bool,
    pub addresses: Vec<Address>,
    pub error: Option<String>,
}

struct Process {
    child: Child,
    token: String,
}

struct Inner {
    info: ServerInfo,
    process: Option<Process>,
    /// 每次启动 / 停止递增，旧的监控线程据此自行退出
    generation: u64,
}

pub struct Server {
    runtime_dir: PathBuf,
    data_dir: Mutex<PathBuf>,
    job: Option<Job>,
    inner: Mutex<Inner>,
}

impl Server {
    pub fn new(runtime_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            runtime_dir: simplify_path(runtime_dir),
            data_dir: Mutex::new(simplify_path(data_dir)),
            job: Job::new(),
            inner: Mutex::new(Inner {
                info: ServerInfo {
                    status: Status::Stopped,
                    port: 0,
                    lan: false,
                    addresses: Vec::new(),
                    error: None,
                },
                process: None,
                generation: 0,
            }),
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.data_dir.lock().unwrap().clone()
    }

    /// 只应在服务停止时调用；下次启动生效
    pub fn set_data_dir(&self, dir: PathBuf) {
        *self.data_dir.lock().unwrap() = simplify_path(dir);
    }

    pub fn log_path(&self) -> PathBuf {
        self.data_dir().join("logs").join("server.log")
    }

    pub fn info(&self) -> ServerInfo {
        self.inner.lock().unwrap().info.clone()
    }

    /// 启动服务；端口和局域网设置未变且正在运行时不重复启动
    pub fn start(self: &Arc<Self>, port: u16, lan: bool) {
        {
            let inner = self.inner.lock().unwrap();
            let same = inner.info.port == port && inner.info.lan == lan;
            if same && inner.process.is_some() && matches!(inner.info.status, Status::Starting | Status::Running) {
                return;
            }
        }
        self.stop();

        let mut inner = self.inner.lock().unwrap();
        inner.generation += 1;
        let generation = inner.generation;
        inner.info = ServerInfo { status: Status::Starting, port, lan, addresses: Vec::new(), error: None };
        match self.spawn(port, lan) {
            Ok(process) => {
                if let Some(job) = &self.job {
                    job.assign(&process.child);
                }
                inner.process = Some(process);
                drop(inner);
                let server = Arc::clone(self);
                thread::spawn(move || server.monitor(generation, port));
            }
            Err(e) => {
                inner.info.status = Status::Error;
                inner.info.error = Some(e);
            }
        }
    }

    fn spawn(&self, port: u16, lan: bool) -> Result<Process, String> {
        let node = self.runtime_dir.join("node.exe");
        let app_dir = self.runtime_dir.join("app");
        let entry = app_dir.join("oa-server.mjs");
        if !node.exists() || !entry.exists() {
            return Err("未找到内置服务端文件，请重新安装客户端".into());
        }
        let data_dir = self.data_dir();
        // 自定义目录可能在移动硬盘或网络盘上，先确认可以访问
        fs::create_dir_all(&data_dir).map_err(|e| format!("无法访问数据目录 {}：{e}", data_dir.display()))?;
        let log_path = data_dir.join("logs").join("server.log");
        if let Some(dir) = log_path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("无法创建日志目录：{e}"))?;
        }
        // 保留上一次运行的日志，便于排查启动失败
        let _ = fs::rename(&log_path, log_path.with_file_name("server.prev.log"));
        let log = File::create(&log_path).map_err(|e| format!("无法写入日志：{e}"))?;
        let log_err = log.try_clone().map_err(|e| e.to_string())?;

        let token = random_token();
        let child = Command::new(&node)
            .arg(&entry)
            .current_dir(&app_dir)
            .env("OA_DATA_DIR", &data_dir)
            .env("OA_PORT", port.to_string())
            .env("OA_BIND", if lan { "0.0.0.0" } else { "127.0.0.1" })
            .env("OA_CONTROL_TOKEN", &token)
            // 用户环境中的 Node 配置可能干扰内置运行时
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("无法启动服务进程：{e}"))?;
        Ok(Process { child, token })
    }

    fn monitor(&self, generation: u64, port: u16) {
        let started = Instant::now();
        let mut ticks: u32 = 0;
        loop {
            thread::sleep(Duration::from_millis(400));
            ticks += 1;
            let status = {
                let mut inner = self.inner.lock().unwrap();
                if inner.generation != generation {
                    return;
                }
                let exited = match inner.process.as_mut() {
                    Some(p) => p.child.try_wait().ok().flatten(),
                    None => return,
                };
                if let Some(exit) = exited {
                    inner.process = None;
                    inner.info.status = Status::Error;
                    inner.info.addresses.clear();
                    inner.info.error = Some(match exit.code() {
                        Some(EXIT_PORT_IN_USE) => format!("端口 {port} 已被其他程序占用，请在服务器设置中更换端口"),
                        code => {
                            let code = code.map(|c| c.to_string()).unwrap_or_else(|| "未知".into());
                            let tail = log_tail(&self.log_path(), 6);
                            if tail.is_empty() {
                                format!("服务进程已退出（退出码 {code}）")
                            } else {
                                format!("服务进程已退出（退出码 {code}）：\n{tail}")
                            }
                        }
                    });
                    return;
                }
                inner.info.status
            };

            // 启动中频繁探测；运行后每 8 秒刷新一次局域网地址（网卡可能变化）
            if status == Status::Starting || ticks % 20 == 0 {
                if let Some(addresses) = health(port) {
                    let mut inner = self.inner.lock().unwrap();
                    if inner.generation != generation {
                        return;
                    }
                    inner.info.status = Status::Running;
                    inner.info.addresses = addresses;
                } else if status == Status::Starting && started.elapsed() > START_TIMEOUT {
                    let mut inner = self.inner.lock().unwrap();
                    if inner.generation != generation {
                        return;
                    }
                    if let Some(mut p) = inner.process.take() {
                        let _ = p.child.kill();
                    }
                    inner.info.status = Status::Error;
                    inner.info.error = Some("服务启动超时，详情见数据目录中的 logs/server.log".into());
                    return;
                }
            }
        }
    }

    /// 请求服务保存协同文档后退出，超时则强制结束。会阻塞至多约 10 秒。
    pub fn stop(&self) {
        let (process, port) = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            inner.info.status = Status::Stopped;
            inner.info.addresses.clear();
            inner.info.error = None;
            (inner.process.take(), inner.info.port)
        };
        let Some(mut p) = process else { return };
        if matches!(p.child.try_wait(), Ok(Some(_))) {
            return;
        }
        let header = format!("x-oa-control: {}\r\n", p.token);
        let _ = request(port, "POST", "/__oa/shutdown", &header, Duration::from_secs(3));
        let deadline = Instant::now() + SHUTDOWN_TIMEOUT;
        while Instant::now() < deadline {
            if matches!(p.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(150));
        }
        let _ = p.child.kill();
        let _ = p.child.wait();
    }
}

fn health(port: u16) -> Option<Vec<Address>> {
    let (status, body) = request(port, "GET", "/__oa/health", "", Duration::from_secs(2))?;
    if status != 200 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&body).ok()?;
    if value.get("ok")?.as_bool() != Some(true) {
        return None;
    }
    let addresses = value
        .get("addresses")
        .and_then(|a| a.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|a| {
                    Some(Address {
                        name: a.get("name")?.as_str()?.to_string(),
                        url: a.get("url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(addresses)
}

/// 极简 HTTP/1.1 请求（只访问本机网关的控制接口，不值得为此引入 HTTP 客户端依赖）
fn request(port: u16, method: &str, path: &str, extra_headers: &str, timeout: Duration) -> Option<(u16, String)> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(1)).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n{extra_headers}\r\n"
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let _ = stream.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let status = text.split_whitespace().nth(1)?.parse().ok()?;
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    Some((status, body))
}

fn log_tail(path: &Path, lines: usize) -> String {
    let Ok(bytes) = fs::read(path) else { return String::new() };
    let text = String::from_utf8_lossy(&bytes);
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    all[all.len().saturating_sub(lines)..].join("\n")
}

/// 控制令牌只在本机回环接口上使用；RandomState 的种子来自系统随机源
fn random_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    (0..4u64)
        .map(|i| {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i);
            h.write_u128(nanos);
            h.write_u32(std::process::id());
            format!("{:016x}", h.finish())
        })
        .collect()
}
