fn main() {
    const COMMANDS: &[&str] = &[
        "launcher_state",
        "server_status",
        "start_server",
        "restart_server",
        "enter_server",
        "connect_server",
        "forget_server",
        "allow_firewall",
        "pick_data_dir",
        "change_data_dir",
        "default_data_target",
        "desktop_context",
        "window_action",
        "window_is_maximized",
        "open_launcher",
        "open_data_dir",
        "set_unread_badge",
        "show_native_notification",
        "focus_main_window",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to configure desktop commands");
}
