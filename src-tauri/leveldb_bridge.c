/*
 * leveldb_bridge.c — thin C bridge to LevelDB for Bedrock world reading.
 *
 * Bedrock Edition uses a Mojang-modified LevelDB with Snappy compression.
 * This bridge exposes a minimal flat API (open/close/get/iterate) that the
 * Rust FFI layer in bedrock/leveldb_ffi.rs wraps into a safe Rust interface.
 *
 * The handle owns a leveldb::DB* and a leveldb::Options (with Snappy
 * compressor wired in). All returned byte buffers are malloc'd — callers
 * must call ldb_free() to release them.
 */

#include <stdlib.h>
#include <string.h>
#include "leveldb/c.h"

/* ── Handle types ────────────────────────────────────────────────────────── */

typedef struct {
    leveldb_t          *db;
    leveldb_options_t  *options;
    leveldb_readoptions_t *read_options;
} LdbHandle;

typedef struct {
    leveldb_iterator_t *it;
    const char         *prefix;
    int                 prefix_len;
} LdbIter;

/* ── Open / close ────────────────────────────────────────────────────────── */

LdbHandle *ldb_open(const char *path, char *err_out, int err_len)
{
    LdbHandle *h = (LdbHandle *)malloc(sizeof(LdbHandle));
    if (!h) return NULL;

    h->options = leveldb_options_create();
    leveldb_options_set_create_if_missing(h->options, 0);

    /* Bedrock uses Snappy compression — this is the default in LevelDB,
     * so we don't need to set it explicitly. LevelDB's built-in Snappy
     * compressor is enabled by default when Snappy is linked. */

    h->read_options = leveldb_readoptions_create();
    leveldb_readoptions_set_fill_cache(h->read_options, 0);

    char *err = NULL;
    h->db = leveldb_open(h->options, path, &err);
    if (err) {
        int n = (int)strlen(err);
        if (n >= err_len) n = err_len - 1;
        if (err_out && err_len > 0) {
            memcpy(err_out, err, (size_t)n);
            err_out[n] = '\0';
        }
        leveldb_free(err);
        leveldb_readoptions_destroy(h->read_options);
        leveldb_options_destroy(h->options);
        free(h);
        return NULL;
    }

    return h;
}

void ldb_close(LdbHandle *h)
{
    if (!h) return;
    leveldb_close(h->db);
    leveldb_readoptions_destroy(h->read_options);
    leveldb_options_destroy(h->options);
    free(h);
}

/* ── Single-key lookup ───────────────────────────────────────────────────── */

uint8_t *ldb_get(LdbHandle *h, const uint8_t *key, int key_len, int *val_len_out)
{
    if (!h || !key || key_len <= 0) { *val_len_out = 0; return NULL; }

    char *err = NULL;
    size_t val_len = 0;
    char *val = leveldb_get(h->db, h->read_options,
                            (const char *)key, (size_t)key_len,
                            &val_len, &err);
    if (err) { leveldb_free(err); *val_len_out = 0; return NULL; }
    if (!val) { *val_len_out = 0; return NULL; }

    /* Copy into malloc'd buffer owned by the caller. */
    uint8_t *buf = (uint8_t *)malloc(val_len);
    if (!buf) { leveldb_free(val); *val_len_out = 0; return NULL; }
    memcpy(buf, val, val_len);
    leveldb_free(val);
    *val_len_out = (int)val_len;
    return buf;
}

void ldb_free(void *ptr) { free(ptr); }

/* ── Prefix iterator ─────────────────────────────────────────────────────── */

LdbIter *ldb_iter_prefix(LdbHandle *h, const uint8_t *prefix, int prefix_len)
{
    if (!h || prefix_len < 0) return NULL;

    LdbIter *it = (LdbIter *)malloc(sizeof(LdbIter));
    if (!it) return NULL;

    it->it = leveldb_create_iterator(h->db, h->read_options);
    if (!it->it) { free(it); return NULL; }

    /* Copy prefix so we can check it during iteration. */
    char *p = (char *)malloc((size_t)prefix_len);
    if (!p && prefix_len > 0) {
        leveldb_iter_destroy(it->it);
        free(it);
        return NULL;
    }
    if (prefix_len > 0) memcpy(p, prefix, (size_t)prefix_len);
    it->prefix     = p;
    it->prefix_len = prefix_len;

    leveldb_iter_seek(it->it, (const char *)prefix, (size_t)prefix_len);
    return it;
}

int ldb_iter_valid(LdbIter *it)
{
    if (!it || !leveldb_iter_valid(it->it)) return 0;
    if (it->prefix_len == 0) return 1;

    size_t klen = 0;
    const char *k = leveldb_iter_key(it->it, &klen);
    if ((int)klen < it->prefix_len) return 0;
    return memcmp(k, it->prefix, (size_t)it->prefix_len) == 0 ? 1 : 0;
}

void ldb_iter_next(LdbIter *it)
{
    if (it && it->it) leveldb_iter_next(it->it);
}

const uint8_t *ldb_iter_key(LdbIter *it, int *len_out)
{
    if (!it) { *len_out = 0; return NULL; }
    size_t klen = 0;
    const char *k = leveldb_iter_key(it->it, &klen);
    *len_out = (int)klen;
    return (const uint8_t *)k;
}

const uint8_t *ldb_iter_value(LdbIter *it, int *len_out)
{
    if (!it) { *len_out = 0; return NULL; }
    size_t vlen = 0;
    const char *v = leveldb_iter_value(it->it, &vlen);
    *len_out = (int)vlen;
    return (const uint8_t *)v;
}

void ldb_iter_free(LdbIter *it)
{
    if (!it) return;
    leveldb_iter_destroy(it->it);
    free((void *)it->prefix);
    free(it);
}
