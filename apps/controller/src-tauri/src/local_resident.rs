use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::Duration};
use tauri_plugin_http::reqwest;

const FAILURE: &str = "이 사용자 계정의 BLACKHOLE 본체 설치와 실행 상태를 확인하세요.";

#[derive(Deserialize)]
struct Config {
    version: u32,
    port: u16,
    #[serde(rename = "tokenFile")]
    token_file: PathBuf,
}

#[derive(Deserialize)]
struct Enrollment {
    device: Device,
}

#[derive(Deserialize)]
struct Device {
    id: String,
    #[serde(rename = "deviceToken")]
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    origin: String,
    device_id: String,
    token: String,
}

fn config() -> Result<Config, &'static str> {
    let home = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or(FAILURE)?)
        .join("BLACKHOLE").join("resident-v2");
    let bytes = std::fs::read_to_string(home.join("config.json")).map_err(|_| FAILURE)?;
    let value: Config = serde_json::from_str(bytes.trim_start_matches('\u{feff}')).map_err(|_| FAILURE)?;
    // Only the known installation's ACL-protected credential is eligible.
    if value.version != 1 || value.port == 0 || value.token_file != home.join("secrets").join("pairing.token") {
        return Err(FAILURE);
    }
    Ok(value)
}

#[tauri::command]
pub fn local_resident_origin() -> Result<String, &'static str> {
    Ok(format!("http://127.0.0.1:{}", config()?.port))
}

#[tauri::command]
pub async fn enroll_local_resident(request_id: String, expected_origin: String) -> Result<Connection, &'static str> {
    let value = config()?;
    let origin = format!("http://127.0.0.1:{}", value.port);
    if origin != expected_origin || request_id.len() != 36 || !request_id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err(FAILURE);
    }
    let token = std::fs::read_to_string(value.token_file).map_err(|_| FAILURE)?;
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10)).build().map_err(|_| FAILURE)?;
    let response = client.post(format!("{origin}/api/v1/devices/enroll"))
        .bearer_auth(token.trim_start_matches('\u{feff}').trim())
        .header("origin", "http://tauri.localhost")
        .header("content-type", "application/json").body(serde_json::json!({"requestId":request_id,"name":"BLACKHOLE Windows Controller","platform":"windows"}).to_string())
        .send().await.map_err(|_| FAILURE)?.error_for_status().map_err(|_| FAILURE)?;
    let enrollment: Enrollment = serde_json::from_slice(&response.bytes().await.map_err(|_| FAILURE)?).map_err(|_| FAILURE)?;
    if enrollment.device.id.is_empty() || enrollment.device.token.is_empty() { return Err(FAILURE); }
    // Only the scoped device credential reaches the existing Stronghold adapter.
    Ok(Connection { origin, device_id: enrollment.device.id, token: enrollment.device.token })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{BufRead, BufReader}, process::{Command, Stdio}};

    #[test]
    fn local_enrollment_uses_real_core_and_recovers_retry_without_exposing_owner_key() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let home = std::env::temp_dir().join(format!("blackhole-native-enroll-{}", std::process::id()));
        std::env::set_var("LOCALAPPDATA", &home);
        let script = r#"
          import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
          const {start}=await import('./runtime/server.mjs');
          const home=path.join(process.env.LOCALAPPDATA,'BLACKHOLE','resident-v2');
          fs.mkdirSync(path.join(home,'secrets'),{recursive:true});
          const token=crypto.randomBytes(32).toString('base64url');
          const tokenFile=path.join(home,'secrets','pairing.token');fs.writeFileSync(tokenFile,token);
          const core=await start({dataDir:path.join(home,'data'),token,host:'127.0.0.1',port:0,env:{}});
          fs.writeFileSync(path.join(home,'config.json'),JSON.stringify({version:1,port:core.server.address().port,tokenFile}));
          console.log('READY');
        "#;
        let mut child = Command::new("node").current_dir(&root).args(["--input-type=module", "-e", script])
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().expect("fixture must start");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut reader = BufReader::new(child.stdout.take().expect("fixture pipe"));
            let mut line = String::new(); reader.read_line(&mut line).expect("fixture readiness");
            assert_eq!(line.trim(), "READY");
            let origin = local_resident_origin().expect("known local config");
            let id = "8172c447-e5f7-4506-a09b-b094d695c356".to_string();
            tauri::async_runtime::block_on(async {
                let first = enroll_local_resident(id.clone(),origin.clone()).await.expect("enrollment");
                let second = enroll_local_resident(id.clone(),origin.clone()).await.expect("retry");
                assert!(first.device_id == second.device_id && first.token == second.token);
                let owner_key = std::fs::read_to_string(config().unwrap().token_file).unwrap();
                assert!(first.token != owner_key);
                assert!(enroll_local_resident(id,"https://other.example".into()).await.is_err());
            });
        }));
        let _ = child.kill(); let _ = child.wait();
        assert!(result.is_ok(), "native local enrollment acceptance failed");
    }
}