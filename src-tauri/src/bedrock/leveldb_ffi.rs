// Raw FFI declarations matching leveldb_bridge.c.
// Do not call these directly — use the safe wrapper in leveldb.rs.

pub enum LdbHandleOpaque {}
pub enum LdbIterOpaque {}

#[cfg(bedrock_ldb)]
#[link(name = "leveldb_snappy")]
unsafe extern "C" {
    pub fn ldb_open(
        path:    *const std::ffi::c_char,
        err_out: *mut std::ffi::c_char,
        err_len: std::ffi::c_int,
    ) -> *mut LdbHandleOpaque;

    pub fn ldb_close(h: *mut LdbHandleOpaque);

    pub fn ldb_get(
        h:           *mut LdbHandleOpaque,
        key:         *const u8,
        key_len:     std::ffi::c_int,
        val_len_out: *mut std::ffi::c_int,
    ) -> *mut u8;

    pub fn ldb_free(ptr: *mut std::ffi::c_void);

    pub fn ldb_iter_prefix(
        h:          *mut LdbHandleOpaque,
        prefix:     *const u8,
        prefix_len: std::ffi::c_int,
    ) -> *mut LdbIterOpaque;

    pub fn ldb_iter_valid(it: *mut LdbIterOpaque) -> std::ffi::c_int;
    pub fn ldb_iter_next (it: *mut LdbIterOpaque);

    pub fn ldb_iter_key(
        it:      *mut LdbIterOpaque,
        len_out: *mut std::ffi::c_int,
    ) -> *const u8;

    pub fn ldb_iter_value(
        it:      *mut LdbIterOpaque,
        len_out: *mut std::ffi::c_int,
    ) -> *const u8;

    pub fn ldb_iter_free(it: *mut LdbIterOpaque);
}
