/* 浏览器里的自动保存（localStorage）：可以存多份蓝图。浏览器禁止存储时安静失败，页面照常能用。 */
(function (root) {
  'use strict';
  var KEY_LIST = 'abb.docs', KEY_CUR = 'abb.cur', PREFIX = 'abb.doc.';
  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  function read(k) { var s = ls(); if (!s) return null; try { return s.getItem(k); } catch (e) { return null; } }
  function write(k, v) { var s = ls(); if (!s) return false; try { s.setItem(k, v); return true; } catch (e) { return false; } }
  function remove(k) { var s = ls(); if (!s) return; try { s.removeItem(k); } catch (e) { /* 忽略 */ } }

  function list() { try { var a = JSON.parse(read(KEY_LIST) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveList(a) { write(KEY_LIST, JSON.stringify(a)); }

  function save(id, doc) {
    var ok = write(PREFIX + id, JSON.stringify(doc));
    var a = list().filter(function (x) { return x.id !== id; });
    a.unshift({ id: id, title: doc.title, updated: Date.now() });
    saveList(a.slice(0, 50));
    return ok;
  }
  function load(id) { var s = read(PREFIX + id); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }
  function del(id) { remove(PREFIX + id); saveList(list().filter(function (x) { return x.id !== id; })); }
  function newId() { return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  root.ABB = root.ABB || {};
  root.ABB.Store = {
    list: list, save: save, load: load, del: del, newId: newId,
    getCur: function () { return read(KEY_CUR); }, setCur: function (id) { write(KEY_CUR, id); },
    get: read, set: write
  };
})(typeof window !== 'undefined' ? window : globalThis);
