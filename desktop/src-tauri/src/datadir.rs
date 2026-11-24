//! 本机服务器数据目录：选择后的解析、校验与迁移。

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::win::simplify_path;

const DB_FILE: &str = "oa.db";
/// 用户选了一个已有其他文件的文件夹时，在其中新建该子文件夹存放数据，避免和用户文件混在一起
const SUBFOLDER: &str = "OA-Workspace";

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub path: String,
    /// 该位置已有工作空间数据（将直接使用，不迁移）
    pub has_workspace: bool,
    /// 实际位置是所选文件夹下新建的子文件夹
    pub subfolder: bool,
    /// 当前目录是否有可迁移的数据（没有时无需让用户选择迁移方式）
    pub current_has_data: bool,
}

pub fn has_workspace(dir: &Path) -> bool {
    dir.join(DB_FILE).is_file()
}

/// 不存在也视为空
pub fn is_empty_dir(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut it| it.next().is_none()).unwrap_or(true)
}

/// 当前目录里是否有值得迁移的数据（日志不算）
pub fn has_data(dir: &Path) -> bool {
    fs::read_dir(dir)
        .map(|it| it.flatten().any(|e| e.file_name() != "logs"))
        .unwrap_or(false)
}

/// 用于比较的规范形式：去掉长路径前缀、统一大小写、忽略 `.` 与末尾分隔符
fn comparable(path: &Path) -> PathBuf {
    let simple = simplify_path(path.to_path_buf());
    let lower = PathBuf::from(simple.to_string_lossy().to_lowercase());
    lower.components().filter(|c| !matches!(c, Component::CurDir)).collect()
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    comparable(a) == comparable(b)
}

/// 选择文件夹后计算实际使用的位置
pub fn resolve(picked: &Path, current: &Path, install_dir: &Path) -> Result<Target, String> {
    let picked = simplify_path(picked.to_path_buf());
    let (dir, subfolder) = if has_workspace(&picked) || is_empty_dir(&picked) {
        (picked, false)
    } else {
        let sub = picked.join(SUBFOLDER);
        if !has_workspace(&sub) && !is_empty_dir(&sub) {
            return Err(format!("{} 中已有其他文件，请选择其他位置", sub.display()));
        }
        (sub, true)
    };
    validate(&dir, current, install_dir)?;
    Ok(Target {
        path: dir.display().to_string(),
        has_workspace: has_workspace(&dir),
        subfolder,
        current_has_data: has_data(current),
    })
}

/// 检查一个指定位置（如恢复默认位置时），不做子文件夹处理
pub fn inspect(dir: &Path, current: &Path, install_dir: &Path) -> Result<Target, String> {
    validate(dir, current, install_dir)?;
    Ok(Target {
        path: dir.display().to_string(),
        has_workspace: has_workspace(dir),
        subfolder: false,
        current_has_data: has_data(current),
    })
}

pub fn validate(dir: &Path, current: &Path, install_dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err("请填写完整的文件夹路径".into());
    }
    if dir.parent().is_none() {
        return Err("请选择一个具体的文件夹（不能是磁盘根目录）".into());
    }
    let (target, cur, install) = (comparable(dir), comparable(current), comparable(install_dir));
    if target == cur {
        return Err("已经是当前的数据目录".into());
    }
    if target.starts_with(&cur) || cur.starts_with(&target) {
        return Err("新位置不能位于当前数据目录之内，也不能包含当前数据目录".into());
    }
    // 安装目录在升级 / 卸载时会被覆盖或删除
    if target.starts_with(&install) {
        return Err("不能放在程序安装目录中，升级或卸载时会被删除".into());
    }
    if !has_workspace(dir) && has_data(dir) {
        return Err("所选文件夹不为空，请选择空文件夹或已有工作空间数据的文件夹".into());
    }
    // 在最近一级已存在的目录里试写，确认有写权限且磁盘可用
    let probe_dir = dir.ancestors().find(|p| p.is_dir()).ok_or("所选位置不可用")?;
    let probe = probe_dir.join(".oa-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("无法写入该位置：{e}"))?;
    let _ = fs::remove_file(probe);
    Ok(())
}

/// 把当前数据复制到新位置（不含日志），原目录保持不动，由用户确认后自行删除
pub fn copy_workspace(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("无法创建 {}：{e}", dst.display()))?;
    copy_dir(src, dst, true)?;
    let size = |p: &Path| fs::metadata(p).map(|m| m.len()).ok();
    if size(&src.join(DB_FILE)) != size(&dst.join(DB_FILE)) {
        return Err("数据库复制后校验失败，请检查磁盘空间后重试".into());
    }
    Ok(())
}

fn copy_dir(src: &Path, dst: &Path, top: bool) -> Result<(), String> {
    let entries = fs::read_dir(src).map_err(|e| format!("无法读取 {}：{e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if top && name == "logs" {
            continue;
        }
        let (from, to) = (entry.path(), dst.join(&name));
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            fs::create_dir_all(&to).map_err(|e| format!("无法创建 {}：{e}", to.display()))?;
            copy_dir(&from, &to, false)?;
        } else if kind.is_file() {
            fs::copy(&from, &to).map_err(|e| format!("复制 {} 失败：{e}", from.display()))?;
        }
    }
    Ok(())
}
