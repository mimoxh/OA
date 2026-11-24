use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_PORT: u16 = 17300;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 本机托管：启动内置服务端，同事经局域网访问
    Server,
    /// 仅客户端：连接已有服务器
    Client,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopConfig {
    pub mode: Option<Mode>,
    pub server_url: Option<String>,
    pub recent_servers: Vec<String>,
    pub port: u16,
    pub lan: bool,
    /// 本机服务器的数据目录；None 表示默认位置（%LOCALAPPDATA%\com.oa.suite.desktop\workspace）
    pub data_dir: Option<String>,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            mode: None,
            server_url: None,
            recent_servers: Vec::new(),
            port: DEFAULT_PORT,
            lan: true,
            data_dir: None,
        }
    }
}

impl DesktopConfig {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| format!("保存配置失败：{e}"))
    }

    pub fn remember_server(&mut self, url: &str) {
        self.recent_servers.retain(|u| u != url);
        self.recent_servers.insert(0, url.to_string());
        self.recent_servers.truncate(6);
    }
}
