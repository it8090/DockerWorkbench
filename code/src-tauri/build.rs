fn main() {
    println!(
        "cargo:rustc-env=WORKBENCH_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
