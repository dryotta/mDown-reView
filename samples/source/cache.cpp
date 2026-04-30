// Sample C++ file — exercises Shiki cpp + brace-folding.

#include <algorithm>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace mdownreview {

template <typename K, typename V>
class TtlCache {
public:
    explicit TtlCache(std::chrono::seconds ttl) : ttl_(ttl) {}

    void put(const K& key, V value) {
        store_[key] = Entry{std::move(value), std::chrono::steady_clock::now()};
    }

    std::optional<V> get(const K& key) {
        auto it = store_.find(key);
        if (it == store_.end()) return std::nullopt;
        if (std::chrono::steady_clock::now() - it->second.inserted_at > ttl_) {
            store_.erase(it);
            return std::nullopt;
        }
        return it->second.value;
    }

    std::size_t size() const noexcept { return store_.size(); }

private:
    struct Entry {
        V value;
        std::chrono::steady_clock::time_point inserted_at;
    };
    std::map<K, Entry> store_;
    std::chrono::seconds ttl_;
};

}  // namespace mdownreview

int main() {
    using namespace std::chrono_literals;
    mdownreview::TtlCache<std::string, int> cache(60s);
    cache.put("alpha", 1);
    cache.put("beta", 2);

    if (auto v = cache.get("alpha"); v.has_value()) {
        std::cout << "alpha = " << *v << " (size=" << cache.size() << ")\n";
    }
    return 0;
}
