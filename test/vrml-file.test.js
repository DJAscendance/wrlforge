'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const zlib = require('zlib');
const { isGzip, editPathFor } = require('../src/files/vrml-file');
const { findVrmlFileArgument } = require('../src/app/file-open');

function desktopOpenDeps(files) {
  const known = new Set(files);
  return {
    resolve: (value) => value.startsWith('/') ? value : `/work/${value}`,
    existsSync: (value) => known.has(value),
    statSync: (value) => ({ isFile: () => known.has(value) }),
  };
}

test('isGzip detects the gzip magic bytes', () => {
  const gz = zlib.gzipSync(Buffer.from('hello', 'utf8'));
  assert.equal(isGzip(gz), true);
});

test('isGzip rejects plain-text buffers', () => {
  const plain = Buffer.from('#VRML V2.0 utf8\n', 'utf8');
  assert.equal(isGzip(plain), false);
});

test('isGzip rejects buffers shorter than 2 bytes', () => {
  assert.equal(isGzip(Buffer.from([])), false);
  assert.equal(isGzip(Buffer.from([0x1f])), false);
});

test('editPathFor derives the .edit.wrl sibling path', () => {
  const mallPath = path.join('items', 'chair.wrl');
  assert.equal(editPathFor(mallPath), path.join('items', 'chair.edit.wrl'));
});

test('editPathFor strips a .wrz extension', () => {
  const mallPath = path.join('items', 'chair.wrz');
  assert.equal(editPathFor(mallPath), path.join('items', 'chair.edit.wrl'));
});

test('editPathFor handles a path with no directory component', () => {
  assert.equal(editPathFor('chair.wrl'), path.join('.', 'chair.edit.wrl'));
});

test('desktop file-open accepts WRL/WRZ arguments and ignores Electron app argv', () => {
  assert.equal(
    findVrmlFileArgument(['/electron', '.', '/models/Item.WRL'], desktopOpenDeps(['/models/Item.WRL'])),
    '/models/Item.WRL',
  );
  assert.equal(
    findVrmlFileArgument(['/app/wrl-forge', '/models/world.wrz'], desktopOpenDeps(['/models/world.wrz'])),
    '/models/world.wrz',
  );
});

test('desktop file-open accepts encoded file URLs', () => {
  assert.equal(
    findVrmlFileArgument(['file:///models/My%20Item.wrl'], desktopOpenDeps(['/models/My Item.wrl'])),
    '/models/My Item.wrl',
  );
});

test('desktop file-open rejects options, directories, unsupported, and missing files', () => {
  const custom = {
    resolve: (value) => value,
    existsSync: (value) => value !== '/missing.wrl',
    statSync: (value) => ({ isFile: () => value !== '/folder.wrl' }),
  };
  assert.equal(
    findVrmlFileArgument(['--inspect', '/folder.wrl', '/image.png', '/missing.wrl'], custom),
    null,
  );
});
