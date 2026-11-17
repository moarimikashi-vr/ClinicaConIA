// Authorization tests for the API against an in-memory Firebase (no network, no real project).
// Run: npm test (node --test)
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.IA_SERVICE_URL = 'http://127.0.0.1:9'; // unreachable: the background IA call fails fast
process.env.IA_SERVICE_TOKEN = 'test-token';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';

const fake = require('./helpers/fakeFirebase').install();
const app = require('../src/app');

let server;
let base;

before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

let T; // tokens per principal
beforeEach(() => {
    fake.reset();
    T = {
        admin: fake.user('admin1', 'administrador'),
        atencion: fake.user('aten1', 'atencion'),
        atencion2: fake.user('aten2', 'atencion'),
        medico: fake.user('med1', 'medico'),
        medico2: fake.user('med2', 'medico'),
        noProfile: fake.user('ghost', null),
    };
    fake.db.put('pacientes/111', { nss: '111', nombre: 'Ana', apellidoP: 'Ruiz' });
    fake.db.put('pacientes/222', { nss: '222', nombre: 'Luis', apellidoP: 'Paz' });
    fake.db.put('casos/c1', {
        pacienteNSS: '111', pacienteNombreCompleto: 'Ana Ruiz', motivoConsulta: 'dolor',
        medicoGeneralId: 'aten1', medicoGeneralNombre: 'N_aten1 A_aten1',
        medicoEspecialistaId: 'med1', medicoEspecialistaNombre: 'N_med1 A_med1',
        estado: 'abierto', fechaCreacion: '2026-11-01T00:00:00.000Z', archivos: [],
    });
});

const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
};

// ---------- S2: authentication on every route ----------

const ROUTES = [
    ['POST', '/users/register'], ['GET', '/users/doctors'], ['GET', '/users/med1'],
    ['POST', '/pacientes'], ['GET', '/pacientes/search'], ['GET', '/pacientes/111'], ['DELETE', '/pacientes/111'],
    ['POST', '/casos'], ['GET', '/casos'], ['GET', '/casos/c1'], ['DELETE', '/casos/c1'],
    ['GET', '/casos/c1/comentarios'], ['POST', '/casos/c1/comentarios'], ['PATCH', '/casos/c1/cerrar'], ['PATCH', '/casos/c1'],
    ['POST', '/reports/c1/generate'],
];

test('every API route rejects requests without a token (401)', async () => {
    for (const [method, path] of ROUTES) {
        const r = await call(method, path, { body: method === 'GET' || method === 'DELETE' ? undefined : {} });
        assert.equal(r.status, 401, `${method} ${path}`);
    }
    assert.equal(fake.db.read('pacientes/111').nombre, 'Ana', 'no data changed');
});

test('a valid Firebase account without a profile is rejected (403) and cannot list cases', async () => {
    const r = await call('GET', '/casos', { token: T.noProfile });
    assert.equal(r.status, 403);
    assert.ok(!Array.isArray(r.body));
});

// ---------- S3: users ----------

test('only an administrador can register users', async () => {
    const body = { nombre: 'Eva', apellido: 'Sol', email: 'eva@test.local', contrasena: 'secreto1', rol: 'administrador' };
    for (const who of ['atencion', 'medico']) {
        const r = await call('POST', '/users/register', { token: T[who], body });
        assert.equal(r.status, 403, who);
    }
    assert.equal(fake.createdUsers.length, 0);
    const ok = await call('POST', '/users/register', { token: T.admin, body });
    assert.equal(ok.status, 201);
    assert.equal(fake.createdUsers.length, 1);
    assert.equal(fake.db.read(`users/${ok.body.uid}`).rol, 'administrador');
});

test('register returns 400 with readable messages for invalid data', async () => {
    const r = await call('POST', '/users/register', { token: T.admin, body: { nombre: 'E', email: 'x', contrasena: '1', rol: 'root' } });
    assert.equal(r.status, 400);
    assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0);
    assert.equal(fake.createdUsers.length, 0);
});

test('a user can read only their own profile unless administrador; 404 leaks no IDs', async () => {
    assert.equal((await call('GET', '/users/med1', { token: T.medico })).status, 200);
    assert.equal((await call('GET', '/users/aten1', { token: T.medico })).status, 403);
    assert.equal((await call('GET', '/users/aten1', { token: T.admin })).status, 200);
    const missing = await call('GET', '/users/nobody', { token: T.admin });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.debug_ids, undefined);
});

test('doctor list is for atencion/administrador and exposes only id and name', async () => {
    assert.equal((await call('GET', '/users/doctors', { token: T.medico })).status, 403);
    const r = await call('GET', '/users/doctors', { token: T.atencion });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map((d) => Object.keys(d).sort()), [['apellido', 'id', 'nombre'], ['apellido', 'id', 'nombre']]);
});

// ---------- S3: patients ----------

test('patient search and writes are restricted to atencion/administrador', async () => {
    assert.equal((await call('GET', '/pacientes/search?q=ana', { token: T.medico })).status, 403);
    assert.equal((await call('POST', '/pacientes', { token: T.medico, body: { nss: '111', nombre: 'X' } })).status, 403);
    assert.equal((await call('DELETE', '/pacientes/111', { token: T.medico })).status, 403);
    assert.equal(fake.db.read('pacientes/111').nombre, 'Ana');

    const s = await call('GET', '/pacientes/search?q=ana', { token: T.atencion });
    assert.equal(s.status, 200);
    assert.equal(s.body.length, 1);
});

test('a medico reads a patient only through an assigned case', async () => {
    assert.equal((await call('GET', '/pacientes/111', { token: T.medico })).status, 200);
    assert.equal((await call('GET', '/pacientes/111', { token: T.medico2 })).status, 403);
    assert.equal((await call('GET', '/pacientes/222', { token: T.medico })).status, 403);
    assert.equal((await call('GET', '/pacientes/222', { token: T.atencion })).status, 200);
});

test('patient save keeps only known fields', async () => {
    const r = await call('POST', '/pacientes', { token: T.atencion, body: { nss: '333', nombre: 'Rita', apellidoP: 'Lu', edad: 30, rol: 'administrador', __proto__x: 1 } });
    assert.equal(r.status, 200);
    const saved = fake.db.read('pacientes/333');
    assert.equal(saved.nombre, 'Rita');
    assert.equal(saved.rol, undefined);
    assert.equal(saved.__proto__x, undefined);
});

// ---------- S3: cases ----------

test('case read, comments and report are limited to participants and administrador', async () => {
    for (const who of ['admin', 'atencion', 'medico']) {
        assert.equal((await call('GET', '/casos/c1', { token: T[who] })).status, 200, who);
    }
    for (const who of ['atencion2', 'medico2']) {
        assert.equal((await call('GET', '/casos/c1', { token: T[who] })).status, 403, who);
        assert.equal((await call('GET', '/casos/c1/comentarios', { token: T[who] })).status, 403, who);
        assert.equal((await call('POST', '/reports/c1/generate', { token: T[who] })).status, 403, who);
    }
});

test('case list stays filtered by role (previous behavior)', async () => {
    fake.db.put('casos/c2', { medicoGeneralId: 'aten2', medicoEspecialistaId: 'med2', estado: 'abierto', fechaCreacion: '2026-11-02T00:00:00.000Z' });
    assert.deepEqual((await call('GET', '/casos', { token: T.medico })).body.map((c) => c.id), ['c1']);
    assert.deepEqual((await call('GET', '/casos', { token: T.atencion2 })).body.map((c) => c.id), ['c2']);
    assert.equal((await call('GET', '/casos', { token: T.admin })).body.length, 2);
});

test('PATCH /casos/:id accepts only the diagnosis from the assigned specialist on an open case', async () => {
    const before = JSON.stringify(fake.db.read('casos/c1'));
    const spoof = await call('PATCH', '/casos/c1', { token: T.medico, body: { diagnostico: 'x', medicoEspecialistaId: 'med2', estado: 'cerrado' } });
    assert.equal(spoof.status, 400);
    assert.equal(JSON.stringify(fake.db.read('casos/c1')), before);

    assert.equal((await call('PATCH', '/casos/c1', { token: T.atencion, body: { diagnostico: 'x' } })).status, 403);
    assert.equal((await call('PATCH', '/casos/c1', { token: T.admin, body: { diagnostico: 'x' } })).status, 403);

    const ok = await call('PATCH', '/casos/c1', { token: T.medico, body: { diagnostico: 'Fractura de tibia' } });
    assert.equal(ok.status, 200);
    assert.equal(fake.db.read('casos/c1').diagnostico, 'Fractura de tibia');

    fake.db.put('casos/c1', { ...fake.db.read('casos/c1'), estado: 'cerrado' });
    assert.equal((await call('PATCH', '/casos/c1', { token: T.medico, body: { diagnostico: 'otro' } })).status, 409);
    assert.equal(fake.db.read('casos/c1').diagnostico, 'Fractura de tibia');
});

test('comment author comes from the token, not from the body', async () => {
    const r = await call('POST', '/casos/c1/comentarios', {
        token: T.atencion,
        body: { texto: 'Hola', autorId: 'sistema_ia', autorNombre: 'Asistente IA', autorRol: 'sistema' },
    });
    assert.equal(r.status, 201);
    const comment = fake.db.read(`casos/c1/comentarios/${r.body.id}`);
    assert.equal(comment.autorId, 'aten1');
    assert.equal(comment.autorNombre, 'N_aten1 A_aten1');
    assert.equal(comment.autorRol, 'atencion');
    assert.equal((await call('POST', '/casos/c1/comentarios', { token: T.medico2, body: { texto: 'x' } })).status, 403);
});

test('notification e-mails escape user-controlled HTML', async () => {
    await call('POST', '/casos/c1/comentarios', { token: T.atencion, body: { texto: '<img src=x onerror=alert(1)>' } });
    assert.equal(fake.sentMail.length, 1);
    assert.ok(!fake.sentMail[0].html.includes('<img'));
    assert.ok(fake.sentMail[0].html.includes('&lt;img'));
});

const nuevoCaso = (over = {}) => ({
    pacienteNSS: '222',
    motivoConsulta: 'golpe',
    medicoEspecialistaId: 'med2',
    archivos: [{ nombre: 'Luis_Paz-222.dcm', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a', size: 10, type: '', uploadPath: 'casos/aten1/222/Luis_Paz-222.dcm' }],
    ...over,
});

test('case creation derives owner and status on the server and drops unknown fields', async () => {
    const r = await call('POST', '/casos', {
        token: T.atencion,
        body: nuevoCaso({ medicoGeneralId: 'aten2', medicoGeneralNombre: 'Otro', estado: 'cerrado', diagnostico: 'fake', iaRegiones: [1] }),
    });
    assert.equal(r.status, 201);
    const caso = fake.db.read(`casos/${r.body.id}`);
    assert.equal(caso.medicoGeneralId, 'aten1');
    assert.equal(caso.medicoGeneralNombre, 'N_aten1 A_aten1');
    assert.equal(caso.medicoEspecialistaNombre, 'N_med2 A_med2');
    assert.equal(caso.pacienteNombreCompleto, 'Luis Paz');
    assert.equal(caso.estado, 'abierto');
    assert.equal(caso.diagnostico, undefined);
    assert.equal(caso.iaRegiones, undefined);
});

test('case creation rejects bad roles, specialists, patients and storage paths', async () => {
    const count = () => [...fake.db.store.keys()].filter((k) => /^casos\/[^/]+$/.test(k)).length;
    const start = count();
    assert.equal((await call('POST', '/casos', { token: T.medico, body: nuevoCaso() })).status, 403);
    assert.equal((await call('POST', '/casos', { token: T.atencion, body: nuevoCaso({ medicoEspecialistaId: 'aten2' }) })).status, 400);
    assert.equal((await call('POST', '/casos', { token: T.atencion, body: nuevoCaso({ pacienteNSS: '999' }) })).status, 400);
    const otherUserPath = nuevoCaso({ archivos: [{ ...nuevoCaso().archivos[0], uploadPath: 'casos/aten2/222/robado.dcm' }] });
    assert.equal((await call('POST', '/casos', { token: T.atencion, body: otherUserPath })).status, 400);
    const traversal = nuevoCaso({ archivos: [{ ...nuevoCaso().archivos[0], uploadPath: 'casos/aten1/222/../../x.dcm' }] });
    assert.equal((await call('POST', '/casos', { token: T.atencion, body: traversal })).status, 400);
    assert.equal(count(), start);
});

test('closing and deleting keep their previous permissions', async () => {
    assert.equal((await call('PATCH', '/casos/c1/cerrar', { token: T.atencion })).status, 403);
    assert.equal((await call('PATCH', '/casos/c1/cerrar', { token: T.medico })).status, 200);
    assert.equal(fake.db.read('casos/c1').estado, 'cerrado');
    assert.equal((await call('DELETE', '/casos/c1', { token: T.medico2 })).status, 403);
    assert.equal((await call('DELETE', '/casos/c1', { token: T.atencion })).status, 200);
    assert.equal(fake.db.read('casos/c1'), undefined);
});

test('error responses do not leak internal messages', async () => {
    fake.db.put('casos/broken', { medicoGeneralId: 'aten1', medicoEspecialistaId: 'med1', estado: 'abierto' });
    const r = await call('GET', '/casos/does-not-exist', { token: T.admin });
    assert.equal(r.status, 404);
    assert.equal(r.body.details, undefined);
    assert.equal(r.body.stack, undefined);
});
