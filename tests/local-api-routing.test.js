'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('auth bootstrap and shared application API routing stay local on loopback hosts',()=>{
  for(const filename of ['frontend/auth.js','frontend/initialization.js']) {
    const source=fs.readFileSync(filename,'utf8');
    const declaration=source.match(/const API_BASE_URL = [\s\S]*?;/)[0];
    for(const hostname of ['localhost','127.0.0.1','[::1]']) {
      const origin=`http://${hostname}:3000`;
      assert.equal(vm.runInNewContext(declaration+'\nAPI_BASE_URL',{window:{location:{hostname,origin}}}),origin,filename);
    }
    assert.equal(vm.runInNewContext(declaration+'\nAPI_BASE_URL',{window:{location:{hostname:'pbangiola.github.io',origin:'https://pbangiola.github.io'}}}),'https://nexttask-production.up.railway.app');
  }
});
