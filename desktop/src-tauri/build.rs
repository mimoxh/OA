fn main() {
    const COMMANDS: &[&str] = &[
        "connect_server",
        "set_unread_badge",
        "show_native_notification",
        "focus_main_window",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to configure desktop commands");
}
