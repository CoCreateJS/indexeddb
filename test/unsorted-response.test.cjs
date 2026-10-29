const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

async function load(indexedDB) {
    const context = vm.createContext({ console, indexedDB });
    const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
    const module = new vm.SourceTextModule(source + '\nexport { createData, getSortPlan, processArray, processDatabase };', { context });
    await module.link(() => new vm.SyntheticModule([
        'ObjectId', 'dotNotationToObject', 'searchData', 'sortData',
        'queryData', 'createUpdate', 'isEqualArray', 'isEqualObject'
    ], function () {
        this.setExport('queryData', (data, query) =>
            Object.entries(query).every(([key, value]) => data[key] === value)
        );
    }, { context }));
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

test('filtered array reads return one scalar name per matching object store', async () => {
    const objectStoreNames = ['users', 'posts', 'events'];
    const indexedDB = {
        open() {
            const request = {
                result: {
                    objectStoreNames,
                    close() {}
                }
            };
            queueMicrotask(() => request.onsuccess());
            return request;
        }
    };
    const { processArray } = await load(indexedDB);
    const data = {
        method: 'array.read',
        array: [],
        filter: { query: { name: 'posts' } }
    };
    const result = [];

    await processArray(data, result, 'app-database', 'array');

    assert.deepEqual(result.map(({ name }) => name), ['posts']);
    assert.equal(typeof result[0].name, 'string');
    assert.deepEqual(Array.from(result[0].$database), ['app-database']);
});

test('database reads return database objects with scalar names and storage metadata', async () => {
    const indexedDB = {
        databases: async () => [
            { name: 'app-database', version: 3 },
            { name: 'cache-database', version: 1 }
        ]
    };
    const { createData, processDatabase } = await load(indexedDB);
    const data = { method: 'database.read' };
    const result = [];

    await processDatabase(data, result, 'database');
    const response = createData(data, result, 'database');

    assert.deepEqual(
        Array.from(response.database, ({ name }) => name),
        ['app-database', 'cache-database']
    );
    assert.equal(typeof response.database[0].name, 'string');
    assert.deepEqual(
        Array.from(response.database, ({ version }) => version),
        [3, 1]
    );
    assert.deepEqual(
        Array.from(response.database[0].$storage),
        ['indexeddb']
    );
});
