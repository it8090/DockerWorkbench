#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
mod updates;
use tokio::sync::oneshot;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;
struct CoreBridge {
    input: Mutex<Option<ChildStdin>>,
    pending: Pending,
    child: Mutex<Child>,
    sequence: AtomicU64,
}
impl CoreBridge {
    fn start(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let packaged = std::env::current_exe()?
            .parent()
            .ok_or("missing application directory")?
            .join(format!("docker-workbench-core{suffix}"));
        let binary = if packaged.is_file() {
            packaged
        } else if cfg!(debug_assertions) {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!(
                    "docker-workbench-core-{}{}",
                    env!("WORKBENCH_TARGET"),
                    suffix
                ))
        } else {
            std::env::current_exe()?
                .parent()
                .ok_or("missing application directory")?
                .join(format!("docker-workbench-core{suffix}"))
        };
        let mut cmd = Command::new(binary);
        cmd.arg("--data-dir")
            .arg(app.path().app_data_dir()?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let mut child = cmd.spawn()?;
        let input = child.stdin.take().ok_or("missing core stdin")?;
        let output = child.stdout.take().ok_or("missing core stdout")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let responses = pending.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value.get("event").and_then(Value::as_str) == Some("stream") {
                    let _ = app_handle.emit("core-stream", &value["payload"]);
                } else if let Some(id) = value.get("id").and_then(Value::as_str) {
                    if let Ok(mut map) = responses.lock() {
                        if let Some(sender) = map.remove(id) {
                            let _ = sender.send(value);
                        }
                    }
                }
            }
            if let Ok(mut map) = responses.lock() {
                for (_, sender) in map.drain() {
                    let _=sender.send(json!({"error":{"code":"core_unavailable","message":"Docker connection core stopped"}}));
                }
            }
            let _ = app_handle.emit("core-status", "stopped");
        });
        Ok(Self {
            input: Mutex::new(Some(input)),
            pending,
            child: Mutex::new(child),
            sequence: AtomicU64::new(1),
        })
    }
    fn stop(&self) {
        if let Ok(mut input) = self.input.lock() {
            input.take();
        }
        if let Ok(mut child) = self.child.lock() {
            for _ in 0..30 {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for CoreBridge {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
async fn core_request(
    bridge: tauri::State<'_, CoreBridge>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    const METHODS: &[&str] = &[
        "system.info",
        "preferences.get",
        "preferences.set",
        "connections.list",
        "workspaces.list",
        "workspaces.save",
        "workspaces.delete",
        "connections.move",
        "connections.save",
        "connections.test",
        "connections.delete",
        "connections.disconnect",
        "connections.discover",
        "connections.export",
        "connections.import",
        "host.trust",
        "resources.snapshot",
        "resources.list",
        "containers.inspect",
        "operations.plan",
        "operations.execute",
        "operations.list",
        "logs.subscribe",
        "stats.subscribe",
        "events.subscribe",
        "stream.cancel",
        "exec.open",
        "exec.input",
        "exec.resize",
        "compose.bind",
        "compose.plan",
        "compose.execute",
    ];
    if !METHODS.contains(&method.as_str()) {
        return Err("method_not_found".into());
    }
    let id = bridge.sequence.fetch_add(1, Ordering::Relaxed).to_string();
    let (sender, receiver) = oneshot::channel();
    bridge
        .pending
        .lock()
        .map_err(|_| "core_unavailable")?
        .insert(id.clone(), sender);
    let request = json!({"id":id,"method":method,"params":params});
    let mut bytes = serde_json::to_vec(&request).map_err(|_| "invalid_request")?;
    if bytes.len() > 3 * 1024 * 1024 {
        bridge
            .pending
            .lock()
            .map_err(|_| "core_unavailable")?
            .remove(&id);
        return Err("request_too_large".into());
    }
    bytes.push(b'\n');
    let write_result = bridge
        .input
        .lock()
        .map_err(|_| "core_unavailable")?
        .as_mut()
        .ok_or("core_unavailable")?
        .write_all(&bytes);
    if write_result.is_err() {
        bridge
            .pending
            .lock()
            .map_err(|_| "core_unavailable")?
            .remove(&id);
        return Err("core_unavailable".into());
    }
    match tokio::time::timeout(Duration::from_secs(180), receiver).await {
        Ok(Ok(value)) => Ok(value),
        _ => {
            bridge
                .pending
                .lock()
                .map_err(|_| "core_unavailable")?
                .remove(&id);
            Err("request_timeout".into())
        }
    }
}
#[tauri::command]
async fn choose_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app
            .dialog()
            .file()
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > 3 * 1024 * 1024 {
            return Err("request_too_large".into());
        };
        std::fs::read_to_string(path)
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_text(app: tauri::AppHandle, name: String, contents: String) -> Result<bool, String> {
    if contents.len() > 64 * 1024 * 1024 {
        return Err("request_too_large".into());
    };
    tauri::async_runtime::spawn_blocking(move || {
        let safe = std::path::Path::new(&name)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("workbench-export.txt");
        let Some(file) = app.dialog().file().set_file_name(safe).blocking_save_file() else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path, contents).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::PendingUpdate::default())
        .setup(|app| {
            let core = CoreBridge::start(app.handle())?;
            app.manage(core);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_request,
            choose_file,
            open_config,
            save_text,
            updates::check_update,
            updates::install_update,
            updates::restart_app
        ])
        .build(tauri::generate_context!())
        .expect("Cannot start Docker Workbench")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<CoreBridge>().stop();
            }
        });
}
