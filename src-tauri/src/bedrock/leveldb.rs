// Safe Rust wrapper around the LevelDB C bridge.
// When the bedrock_ldb feature is absent (submodule not yet initialized),
// all methods return errors / empty results so the rest of the codebase
// can compile without the native library present.

use std::ffi::CString;
use std::marker::PhantomData;

#[cfg(bedrock_ldb)]
use super::leveldb_ffi as ffi;

pub struct LdbDatabase {
    #[cfg(bedrock_ldb)]
    ptr: *mut ffi::LdbHandleOpaque,
    #[cfg(not(bedrock_ldb))]
    _phantom: (),
}

// SAFETY: LevelDB's C API is thread-safe for concurrent reads; we never share
// mutable state across threads without holding the Tauri-managed Mutex.
unsafe impl Send for LdbDatabase {}
unsafe impl Sync for LdbDatabase {}

impl LdbDatabase {
    pub fn open(path: &str) -> Result<Self, String> {
        #[cfg(bedrock_ldb)]
        {
            let c_path = CString::new(path).map_err(|e| e.to_string())?;
            let mut err_buf = vec![0i8; 512];
            let ptr = unsafe {
                ffi::ldb_open(c_path.as_ptr(), err_buf.as_mut_ptr(), 512)
            };
            if ptr.is_null() {
                let msg = err_buf.iter()
                    .take_while(|&&c| c != 0)
                    .map(|&c| c as u8 as char)
                    .collect::<String>();
                return Err(format!("LevelDB open failed: {msg}"));
            }
            Ok(Self { ptr })
        }
        #[cfg(not(bedrock_ldb))]
        {
            let _ = path;
            Err("LevelDB support not compiled in (run: git submodule update --init leveldb snappy)".into())
        }
    }

    pub fn get(&self, key: &[u8]) -> Option<Vec<u8>> {
        #[cfg(bedrock_ldb)]
        {
            let mut val_len: std::ffi::c_int = 0;
            let ptr = unsafe {
                ffi::ldb_get(self.ptr, key.as_ptr(), key.len() as std::ffi::c_int, &mut val_len)
            };
            if ptr.is_null() { return None; }
            let buf = unsafe { std::slice::from_raw_parts(ptr, val_len as usize).to_vec() };
            unsafe { ffi::ldb_free(ptr as *mut std::ffi::c_void) };
            Some(buf)
        }
        #[cfg(not(bedrock_ldb))]
        { let _ = key; None }
    }

    pub fn iter_prefix<'a>(&'a self, prefix: &[u8]) -> LdbPrefixIter<'a> {
        #[cfg(bedrock_ldb)]
        {
            let ptr = unsafe {
                ffi::ldb_iter_prefix(self.ptr, prefix.as_ptr(), prefix.len() as std::ffi::c_int)
            };
            LdbPrefixIter { ptr, _db: PhantomData }
        }
        #[cfg(not(bedrock_ldb))]
        { let _ = prefix; LdbPrefixIter { _db: PhantomData } }
    }
}

impl Drop for LdbDatabase {
    fn drop(&mut self) {
        #[cfg(bedrock_ldb)]
        unsafe { ffi::ldb_close(self.ptr) }
    }
}

pub struct LdbPrefixIter<'a> {
    #[cfg(bedrock_ldb)]
    ptr:  *mut ffi::LdbIterOpaque,
    _db:  PhantomData<&'a LdbDatabase>,
}

impl<'a> Iterator for LdbPrefixIter<'a> {
    type Item = (Vec<u8>, Vec<u8>);

    fn next(&mut self) -> Option<Self::Item> {
        #[cfg(bedrock_ldb)]
        {
            if self.ptr.is_null() { return None; }
            if unsafe { ffi::ldb_iter_valid(self.ptr) } == 0 { return None; }

            let mut klen: std::ffi::c_int = 0;
            let mut vlen: std::ffi::c_int = 0;
            let k_ptr = unsafe { ffi::ldb_iter_key  (self.ptr, &mut klen) };
            let v_ptr = unsafe { ffi::ldb_iter_value(self.ptr, &mut vlen) };

            let key = unsafe { std::slice::from_raw_parts(k_ptr, klen as usize).to_vec() };
            let val = unsafe { std::slice::from_raw_parts(v_ptr, vlen as usize).to_vec() };

            unsafe { ffi::ldb_iter_next(self.ptr) };
            Some((key, val))
        }
        #[cfg(not(bedrock_ldb))]
        None
    }
}

impl<'a> Drop for LdbPrefixIter<'a> {
    fn drop(&mut self) {
        #[cfg(bedrock_ldb)]
        if !self.ptr.is_null() {
            unsafe { ffi::ldb_iter_free(self.ptr) }
        }
    }
}
