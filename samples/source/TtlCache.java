// Sample Java file — exercises Shiki java + brace-folding.

package com.mdownreview.cache;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe TTL cache.
 */
public final class TtlCache<K, V> {

    private record Entry<V>(V value, Instant insertedAt) {}

    private final Map<K, Entry<V>> store = new ConcurrentHashMap<>();
    private final Duration ttl;

    public TtlCache(Duration ttl) {
        this.ttl = ttl;
    }

    public void put(K key, V value) {
        store.put(key, new Entry<>(value, Instant.now()));
    }

    public Optional<V> get(K key) {
        Entry<V> entry = store.get(key);
        if (entry == null) {
            return Optional.empty();
        }
        if (Duration.between(entry.insertedAt(), Instant.now()).compareTo(ttl) > 0) {
            store.remove(key);
            return Optional.empty();
        }
        return Optional.of(entry.value());
    }

    public int size() {
        return store.size();
    }

    public static void main(String[] args) {
        TtlCache<String, Integer> cache = new TtlCache<>(Duration.ofMinutes(1));
        cache.put("alpha", 1);
        cache.put("beta", 2);
        System.out.printf("alpha = %s (size=%d)%n", cache.get("alpha"), cache.size());
    }
}
