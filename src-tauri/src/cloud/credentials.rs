const KEYCHAIN_SERVICE: &str = "com.hibachi.voicelatte.cloud";

#[tauri::command]
pub fn set_api_key(
    state: State<'_, CloudState>,
    provider: String,
    key: String,
) -> Result<String, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("cloud.key_empty".into());
    }
    let entry = credential(&provider)?;
    // まずダイアログを出さずに上書きを試す。署名が一致していれば無音で成功する。
    // 失敗したら（＝署名変更などで既存項目に書けない）ダイアログ込みで作り直す。
    // 先に消すと保存失敗時に既存キーごと失われるので、この順序は入れ替えない。
    if without_keychain_ui(|| entry.set_password(key)).is_err() {
        let _ = entry.delete_credential();
        entry
            .set_password(key)
            .map_err(|_| "cloud.key_save".to_string())?;
    }
    state
        .keys
        .lock()
        .map_err(|_| "cloud.key_save")?
        .insert(provider, key.to_string());
    Ok(mask_api_key(key))
}

#[tauri::command]
pub fn api_key_present(provider: String) -> Result<bool, String> {
    validate_provider(&provider)?;
    api_key_present_impl(&provider)
}

#[cfg(target_os = "macos")]
fn api_key_present_impl(provider: &str) -> Result<bool, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions};

    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
    let mut options = ItemSearchOptions::new();
    options
        .class(ItemClass::generic_password())
        .service(KEYCHAIN_SERVICE)
        .account(provider)
        .load_attributes(true);
    match options.search() {
        Ok(items) => Ok(!items.is_empty()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(false),
        Err(_) => Err("cloud.key_status".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn api_key_present_impl(provider: &str) -> Result<bool, String> {
    match credential(&provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(_) => Err("cloud.key_status".into()),
    }
}

#[tauri::command]
pub fn clear_api_key(state: State<'_, CloudState>, provider: String) -> Result<(), String> {
    match credential(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            state
                .keys
                .lock()
                .map_err(|_| "cloud.key_delete")?
                .remove(&provider);
            Ok(())
        }
        Err(_) => Err("cloud.key_delete".into()),
    }
}

/// Keychainのモーダル（「キーチェーンのパスワードを入力してください」）を抑止して実行する。
/// 署名が変わった項目へのアクセスは、ダイアログではなく即エラーで返るようになる。
/// プロセス全体のフラグなので、抑止したい操作だけを短く包むこと。
#[cfg(target_os = "macos")]
fn without_keychain_ui<T>(operation: impl FnOnce() -> T) -> T {
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
    }
    // プロセス全体のフラグなので、同時に走ると先に終わった側が抑止を解いてしまう。
    static UI_LOCK: Mutex<()> = Mutex::new(());
    let _guard = UI_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    unsafe { SecKeychainSetUserInteractionAllowed(0) };
    let result = operation();
    unsafe { SecKeychainSetUserInteractionAllowed(1) };
    result
}

#[cfg(not(target_os = "macos"))]
fn without_keychain_ui<T>(operation: impl FnOnce() -> T) -> T {
    operation()
}

fn credential(provider: &str) -> Result<keyring::Entry, String> {
    validate_provider(provider)?;
    keyring::Entry::new(KEYCHAIN_SERVICE, provider).map_err(|_| "cloud.credential_store".into())
}

fn validate_provider(provider: &str) -> Result<(), String> {
    if !matches!(provider, "groq" | "gemini") {
        return Err("cloud.invalid_provider".into());
    }
    Ok(())
}

/// 読み出し失敗時のコード。macOSは署名変更によるACL拒否が主因なので再入力導線に繋ぐ。
#[cfg(target_os = "macos")]
const KEY_READ_FAILURE: &str = "cloud.key_denied";

#[cfg(not(target_os = "macos"))]
const KEY_READ_FAILURE: &str = "cloud.key_read";

fn resolve_key(state: &State<'_, CloudState>, provider: &str) -> Result<String, String> {
    if let Some(key) = state
        .keys
        .lock()
        .map_err(|_| KEY_READ_FAILURE)?
        .get(provider)
        .cloned()
    {
        return Ok(key);
    }
    let entry = credential(provider)?;
    let key = without_keychain_ui(|| entry.get_password()).map_err(|error| match error {
        keyring::Error::NoEntry => "cloud.key_missing".to_string(),
        _ => KEY_READ_FAILURE.to_string(),
    })?;
    state
        .keys
        .lock()
        .map_err(|_| KEY_READ_FAILURE)?
        .insert(provider.to_string(), key.clone());
    Ok(key)
}

fn mask_api_key(key: &str) -> String {
    let suffix: String = key
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if suffix.chars().count() < 4 {
        "••••••••".into()
    } else {
        format!("••••••••{suffix}")
    }
}
