#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use serde::Serialize;

#[derive(Serialize)]
struct SeratoScannerData {
    file_name: String,
    found_tracks: Vec<String>,
}

#[tauri::command]
fn get_latest_serato_track() -> Result<SeratoScannerData, String> {
    let mut path = dirs::audio_dir().ok_or("Impossible de trouver le dossier Musique")?;
    
    // LA RÉVOLUTION : On pointe directement sur le dossier des Logs en temps réel
    path.push("_Serato_");
    path.push("Logs");

    if !path.exists() {
        return Err(format!("Le dossier Logs n'existe pas : {:?}", path));
    }

    let mut latest_file: Option<PathBuf> = None;
    let mut latest_time = std::time::SystemTime::UNIX_EPOCH;

    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;

    // 1. On cherche le fichier .log le plus récent (celui qui tourne actuellement)
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();
        
        if file_path.is_file() && file_path.extension().unwrap_or_default() == "log" {
            let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
            let modified_time = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            
            if modified_time > latest_time {
                latest_time = modified_time;
                latest_file = Some(file_path);
            }
        }
    }

    if let Some(file_path) = latest_file {
        // On lit le journal de bord de Serato
        let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        let mut all_titles = Vec::new();
        
        // Les formats audio que l'on recherche dans le texte
        let extensions = [".mp3", ".wav", ".flac", ".aiff", ".m4a"];
        
        for line in content.lines() {
            for ext in extensions.iter() {
                // Si la ligne mentionne un fichier audio (chargement sur platine)
                if let Some(ext_idx) = line.find(ext) {
                    // On remonte jusqu'au dernier '/' pour isoler le nom du fichier
                    if let Some(slash_idx) = line[..ext_idx].rfind('/') {
                        let raw_name = &line[slash_idx + 1 .. ext_idx];
                        let clean_name = raw_name.replace("%20", " ").trim().to_string();
                        
                        // On évite d'ajouter 10 fois le même morceau s'il est mentionné plusieurs fois de suite
                        if !clean_name.is_empty() && all_titles.last() != Some(&clean_name) {
                            all_titles.push(clean_name);
                        }
                    }
                    break;
                }
            }
        }

        let start_index = if all_titles.len() > 10 { all_titles.len() - 10 } else { 0 };
        let last_10_tracks = all_titles[start_index..].to_vec();
        let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().into_owned();

        return Ok(SeratoScannerData {
            file_name,
            found_tracks: last_10_tracks,
        });
    }

    Err(format!("Aucun fichier .log récent trouvé."))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init()) // NOUVEAU : Le moteur de redémarrage
        .invoke_handler(tauri::generate_handler![get_latest_serato_track])
        .run(tauri::generate_context!())
        .expect("Erreur Tauri");
}