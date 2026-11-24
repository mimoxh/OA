//! Windows 专用：子进程随壳退出、WebView User-Agent 标记、防火墙规则。

use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings2;
use windows::core::{Interface, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 设置了 KILL_ON_JOB_CLOSE 的作业对象：壳进程无论以何种方式退出（含崩溃），系统都会结束其中的服务进程。
/// 句柄在进程生命周期内一直持有，不主动关闭。
pub struct Job(isize);

impl Job {
    pub fn new() -> Option<Self> {
        unsafe {
            let job = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(Self(job.0 as isize))
        }
    }

    pub fn assign(&self, child: &Child) {
        unsafe {
            let _ = AssignProcessToJobObject(
                HANDLE(self.0 as *mut core::ffi::c_void),
                HANDLE(child.as_raw_handle() as *mut core::ffi::c_void),
            );
        }
    }
}

/// 在 WebView2 默认 User-Agent 末尾追加标记，服务端据此直接渲染桌面顶栏，避免首帧闪动。
pub fn append_user_agent(window: &WebviewWindow, mark: String) {
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let Ok(settings) = settings.cast::<ICoreWebView2Settings2>() else { return };
        let mut raw = PWSTR::null();
        if settings.UserAgent(&mut raw).is_err() || raw.is_null() {
            return;
        }
        let current = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void));
        if !current.contains(&mark) {
            let _ = settings.SetUserAgent(&HSTRING::from(format!("{current} {mark}")));
        }
    });
}

/// 以管理员身份添加入站规则（会弹出 UAC 确认）。仅作用于专用 / 域网络。
pub fn add_firewall_rule(port: u16) -> Result<(), String> {
    let name = "OA Suite Server";
    let netsh = format!(
        "/c netsh advfirewall firewall delete rule name=\"{name}\" & netsh advfirewall firewall add rule name=\"{name}\" dir=in action=allow protocol=TCP localport={port} profile=private,domain"
    );
    let script = format!(
        "Start-Process -FilePath cmd.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '{}'",
        netsh.replace('\'', "''")
    );
    let status = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("无法调用 PowerShell：{e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("未完成：可能取消了管理员授权".to_string())
    }
}

/// 去掉 `\\?\` 长路径前缀：Tauri 解析出的资源目录带该前缀，Node 的模块解析无法处理（lstat 'D:' 报 EISDIR）
pub fn simplify_path(path: std::path::PathBuf) -> std::path::PathBuf {
    let s = path.to_string_lossy().into_owned();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return std::path::PathBuf::from(format!(r"\\{rest}"));
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => std::path::PathBuf::from(rest),
        _ => path,
    }
}

/// 系统「选择文件夹」对话框；取消时返回 None。owner 为父窗口句柄，对话框期间父窗口不可操作。
pub fn pick_folder(owner: isize, title: &str, initial: Option<&std::path::Path>) -> Option<std::path::PathBuf> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };

    unsafe {
        // 在后台线程调用，需要为本线程初始化 COM（STA）
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| -> windows::core::Result<Option<std::path::PathBuf>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            dialog.SetTitle(&HSTRING::from(title))?;
            if let Some(dir) = initial.filter(|d| d.exists()) {
                if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(dir.as_os_str()), None) {
                    let _ = dialog.SetFolder(&item);
                }
            }
            let owner = (owner != 0).then(|| HWND(owner as *mut core::ffi::c_void));
            if dialog.Show(owner).is_err() {
                return Ok(None);
            }
            let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = raw.to_string().unwrap_or_default();
            CoTaskMemFree(Some(raw.0 as *const core::ffi::c_void));
            Ok((!path.is_empty()).then(|| std::path::PathBuf::from(path)))
        })();
        if initialized {
            CoUninitialize();
        }
        result.ok().flatten()
    }
}

pub fn open_in_explorer(path: &std::path::Path) {
    let _ = Command::new("explorer.exe").arg(path).spawn();
}
