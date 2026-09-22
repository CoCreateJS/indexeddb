const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

async function load() {
    const context = vm.createContext({ console });
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const module = new vm.SourceTextModule(source + '\nexport { createData, getSortPlan };', { context });
    await module.link(() => new vm.SyntheticModule([
        'ObjectId', 'dotNotationToObject', 'searchData', 'sortData',
        'queryData', 'createUpdate', 'isEqualArray', 'isEqualObject'
    ], function () {}, { context }));
    await module.evaluate();
    return module.namespace;
}

test('unsorted table read returns its response instead of throwing', async () => {
    const { createData } = await load();
    const object = [{ _id: 'app', fields: [{ label: 'Name' }] }];
    const data = { method: 'object.read', object: [], filter: { index: 0, overwrite: true } };
    assert.equal(createData(data, object, 'object'), data);
    assert.deepEqual(data.object, object);
    assert.equal(data.filter.index, 1);
});

test('queue deletion returns queued requests without requiring a sort', async () => {
    const { createData } = await load();
    const queued = { _id: 'queue-entry', data: { uuid: 'request' }, status: 'queued' };
    const data = { method: 'object.delete', object: [], filter: { query: { status: 'queued' } } };
    assert.equal(createData(data, [queued], 'object').object[0], queued);
});

test('sort planning supports absent, empty and named sort fields', async () => {
    const { getSortPlan } = await load();
    for (const filter of [undefined, {}, { sort: [] }, { sort: [{}] }])
        assert.equal(getSortPlan(filter).indexName, undefined);
    assert.equal(getSortPlan({ sort: [{ key: '_id' }] }).indexName, undefined);
    assert.equal(getSortPlan({ sort: [{ key: 'name', direction: 'desc' }] }).indexName, 'name');
    assert.equal(getSortPlan({ sort: [{ key: 'name', direction: 'desc' }] }).direction, 'prev');
});
