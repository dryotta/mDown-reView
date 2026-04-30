// Sample Go file — exercises Shiki go and brace-based folding.

package cache

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrNotFound is returned when a key is missing or has expired.
var ErrNotFound = errors.New("cache: not found")

// Entry is a single cache record with insertion timestamp.
type Entry[V any] struct {
	Value     V
	InsertedAt time.Time
}

// Cache is a TTL-evicting in-memory cache, safe for concurrent use.
type Cache[K comparable, V any] struct {
	mu    sync.RWMutex
	ttl   time.Duration
	store map[K]Entry[V]
}

// New constructs a cache with the given TTL.
func New[K comparable, V any](ttl time.Duration) *Cache[K, V] {
	return &Cache[K, V]{
		ttl:   ttl,
		store: make(map[K]Entry[V]),
	}
}

// Get returns the value for k, or ErrNotFound if missing/expired.
func (c *Cache[K, V]) Get(k K) (V, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.store[k]
	var zero V
	if !ok {
		return zero, ErrNotFound
	}
	if time.Since(e.InsertedAt) > c.ttl {
		return zero, ErrNotFound
	}
	return e.Value, nil
}

// Put inserts a value into the cache.
func (c *Cache[K, V]) Put(k K, v V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.store[k] = Entry[V]{Value: v, InsertedAt: time.Now()}
}

// Len returns the number of entries (including expired ones not yet evicted).
func (c *Cache[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.store)
}

func main() {
	c := New[string, int](time.Minute)
	c.Put("a", 1)
	c.Put("b", 2)
	v, err := c.Get("a")
	if err != nil {
		fmt.Println("miss:", err)
		return
	}
	fmt.Printf("a = %d (len=%d)\n", v, c.Len())
}
