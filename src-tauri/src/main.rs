// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Display options that must be set before the window exists (Linux: renderer mode)
    remoteflow_lib::display::apply_before_start();

    remoteflow_lib::run()
}
