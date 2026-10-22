//! Language of backend messages (errors, status texts) – set by the UI via `app_set_language`.
use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn is_en() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

fn is_english_code(lang: &str) -> bool {
    lang.trim().to_ascii_lowercase().starts_with("en")
}

pub fn set_language(lang: &str) {
    ENGLISH.store(is_english_code(lang), Ordering::Relaxed);
}

/// `tr!("polski", "english")` → `&'static str`;
/// `tr!("polski {}", "english {}", args…)` → `String` (like `format!`).
#[macro_export]
macro_rules! tr {
    ($pl:literal, $en:literal $(,)?) => {
        if $crate::i18n::is_en() { $en } else { $pl }
    };
    ($pl:literal, $en:literal, $($arg:tt)+) => {
        if $crate::i18n::is_en() { format!($en, $($arg)+) } else { format!($pl, $($arg)+) }
    };
}

#[tauri::command]
pub fn app_set_language(lang: String) {
    set_language(&lang);
}

#[cfg(test)]
mod tests {
    // The language flag is global, so tests never switch it (other tests run in parallel).
    #[test]
    fn language_codes() {
        assert!(super::is_english_code("en"));
        assert!(super::is_english_code("EN-gb"));
        assert!(!super::is_english_code("pl"));
    }

    #[test]
    fn macro_formats_like_format() {
        let expected_pl = "3 plików";
        let expected_en = "3 files";
        let got = tr!("{} plików", "{} files", 3);
        assert!(got == expected_pl || got == expected_en);
        assert_eq!(tr!("Tak", "Yes").len(), 3);
    }
}
