//! LRU frame cache implementation

use linked_hash_map::LinkedHashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::Instant;

/// Cache key: (file_id, frame_number)
type CacheKey = (String, u32);

/// Cached frame data
#[derive(Clone)]
pub struct CachedFrame {
    pub data: Arc<Vec<u8>>,
    pub width: u32,
    pub height: u32,
    pub timestamp: Instant,
}

impl CachedFrame {
    pub fn size(&self) -> usize {
        self.data.len()
    }
}

/// Thread-safe LRU frame cache
pub struct FrameCache {
    inner: RwLock<FrameCacheInner>,
    max_bytes: usize,
}

struct FrameCacheInner {
    frames: LinkedHashMap<CacheKey, CachedFrame>,
    current_bytes: usize,
}

impl FrameCache {
    /// Create a new frame cache with max size in MB
    pub fn new(max_mb: usize) -> Self {
        Self {
            inner: RwLock::new(FrameCacheInner {
                frames: LinkedHashMap::new(),
                current_bytes: 0,
            }),
            max_bytes: max_mb * 1024 * 1024,
        }
    }

    /// Get a frame from cache, updating access order
    pub fn get(&self, file_id: &str, frame: u32) -> Option<CachedFrame> {
        let mut inner = self.inner.write();
        let key = (file_id.to_string(), frame);

        // Get and refresh (move to back)
        if let Some(cached) = inner.frames.get_refresh(&key) {
            return Some(cached.clone());
        }

        None
    }

    /// Check if frame is in cache without updating access order
    pub fn contains(&self, file_id: &str, frame: u32) -> bool {
        let inner = self.inner.read();
        inner.frames.contains_key(&(file_id.to_string(), frame))
    }

    /// Insert a frame into cache
    pub fn insert(&self, file_id: &str, frame: u32, data: Vec<u8>, width: u32, height: u32) {
        let frame_size = data.len();

        // Don't cache if single frame exceeds max
        if frame_size > self.max_bytes {
            return;
        }

        let mut inner = self.inner.write();
        let key = (file_id.to_string(), frame);

        // Remove existing entry if present
        if let Some(old) = inner.frames.remove(&key) {
            inner.current_bytes = inner.current_bytes.saturating_sub(old.size());
        }

        // Evict until we have space
        while inner.current_bytes + frame_size > self.max_bytes {
            if let Some((_, evicted)) = inner.frames.pop_front() {
                inner.current_bytes = inner.current_bytes.saturating_sub(evicted.size());
            } else {
                break;
            }
        }

        // Insert new frame
        let cached = CachedFrame {
            data: Arc::new(data),
            width,
            height,
            timestamp: Instant::now(),
        };

        inner.frames.insert(key, cached);
        inner.current_bytes += frame_size;
    }

    /// Remove all frames for a file
    pub fn remove_file(&self, file_id: &str) {
        let mut inner = self.inner.write();
        let keys_to_remove: Vec<_> = inner
            .frames
            .keys()
            .filter(|(fid, _)| fid == file_id)
            .cloned()
            .collect();

        for key in keys_to_remove {
            if let Some(removed) = inner.frames.remove(&key) {
                inner.current_bytes = inner.current_bytes.saturating_sub(removed.size());
            }
        }
    }

    /// Get cache statistics
    pub fn stats(&self) -> CacheStats {
        let inner = self.inner.read();
        CacheStats {
            used_bytes: inner.current_bytes,
            max_bytes: self.max_bytes,
            frame_count: inner.frames.len(),
        }
    }

    /// Clear the entire cache
    pub fn clear(&self) {
        let mut inner = self.inner.write();
        inner.frames.clear();
        inner.current_bytes = 0;
    }

    /// Get frames near a position (for prefetch planning)
    pub fn get_missing_in_range(
        &self,
        file_id: &str,
        center: u32,
        radius: u32,
    ) -> Vec<u32> {
        let inner = self.inner.read();
        let start = center.saturating_sub(radius);
        let end = center + radius;

        (start..=end)
            .filter(|&f| !inner.frames.contains_key(&(file_id.to_string(), f)))
            .collect()
    }

    /// Prioritize frames near playhead (move to back of LRU)
    pub fn touch_range(&self, file_id: &str, center: u32, radius: u32) {
        let mut inner = self.inner.write();
        let start = center.saturating_sub(radius);
        let end = center + radius;

        for frame in start..=end {
            let key = (file_id.to_string(), frame);
            // get_refresh moves to back of LRU
            let _ = inner.frames.get_refresh(&key);
        }
    }
}

/// Cache statistics
#[derive(Debug, Clone)]
pub struct CacheStats {
    pub used_bytes: usize,
    pub max_bytes: usize,
    pub frame_count: usize,
}

impl CacheStats {
    pub fn used_mb(&self) -> usize {
        self.used_bytes / (1024 * 1024)
    }

    pub fn max_mb(&self) -> usize {
        self.max_bytes / (1024 * 1024)
    }

    pub fn utilization(&self) -> f32 {
        if self.max_bytes == 0 {
            0.0
        } else {
            self.used_bytes as f32 / self.max_bytes as f32
        }
    }
}
