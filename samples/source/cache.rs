// Sample Rust file — exercises Shiki rust + the fold-region detector
// (`src-tauri/src/core/fold_regions.rs`) on brace-based folding.

use std::collections::HashMap;
use std::path::Path;

/// A simple in-memory cache with TTL eviction.
pub struct Cache<K, V>
where
    K: Eq + std::hash::Hash + Clone,
{
    inner: HashMap<K, (V, std::time::Instant)>,
    ttl: std::time::Duration,
}

impl<K, V> Cache<K, V>
where
    K: Eq + std::hash::Hash + Clone,
    V: Clone,
{
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            inner: HashMap::new(),
            ttl: std::time::Duration::from_secs(ttl_secs),
        }
    }

    pub fn insert(&mut self, k: K, v: V) {
        self.inner.insert(k, (v, std::time::Instant::now()));
    }

    pub fn get(&mut self, k: &K) -> Option<V> {
        let entry = self.inner.get(k)?;
        if entry.1.elapsed() > self.ttl {
            self.inner.remove(k);
            None
        } else {
            Some(entry.0.clone())
        }
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoadError {
    NotFound,
    PermissionDenied,
    InvalidUtf8,
    TooLarge { actual: u64, limit: u64 },
}

pub fn load_text<P: AsRef<Path>>(path: P, max_bytes: u64) -> Result<String, LoadError> {
    use std::io::Read;
    let path = path.as_ref();
    let mut file = std::fs::File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => LoadError::NotFound,
        std::io::ErrorKind::PermissionDenied => LoadError::PermissionDenied,
        _ => LoadError::NotFound,
    })?;
    let mut buf = Vec::new();
    file.by_ref()
        .take(max_bytes + 1)
        .read_to_end(&mut buf)
        .map_err(|_| LoadError::NotFound)?;
    if buf.len() as u64 > max_bytes {
        return Err(LoadError::TooLarge {
            actual: buf.len() as u64,
            limit: max_bytes,
        });
    }
    String::from_utf8(buf).map_err(|_| LoadError::InvalidUtf8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_round_trip() {
        let mut cache: Cache<&str, i32> = Cache::new(60);
        cache.insert("a", 1);
        cache.insert("b", 2);
        assert_eq!(cache.get(&"a"), Some(1));
        assert_eq!(cache.get(&"b"), Some(2));
        assert_eq!(cache.get(&"c"), None);
        assert_eq!(cache.len(), 2);
    }
}
