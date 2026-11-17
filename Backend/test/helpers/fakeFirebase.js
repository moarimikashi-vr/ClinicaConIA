// In-memory stand-in for src/config/firebase.js and src/config/mailer.js.
// Installed into require.cache before the app is loaded, so no real Firebase project is touched.
const path = require('path');

let autoId = 0;
const nextId = () => `auto${++autoId}`;

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const isSentinel = (v) => v && typeof v === 'object' && v.constructor && /FieldValue|Transform/.test(v.constructor.name);

const applyUpdate = (current, updates) => {
    const out = { ...current };
    for (const [k, v] of Object.entries(updates)) {
        if (isSentinel(v)) {
            // arrayUnion from firebase-admin: append the elements we can read back
            const elements = v._elements || v.elements || [];
            out[k] = [...(out[k] || []), ...clone(elements)];
        } else {
            out[k] = clone(v);
        }
    }
    return out;
};

const createDb = () => {
    const store = new Map(); // path -> data
    const failing = new Set(); // collection names whose reads throw (simulated outage)
    const maybeFail = (collPath) => {
        if (failing.has(collPath.split('/')[0])) throw new Error('internal firestore detail: DEADLINE_EXCEEDED');
    };

    const docRef = (collPath, id) => {
        const full = `${collPath}/${id}`;
        return {
            id,
            path: full,
            async get() {
                maybeFail(collPath);
                const data = store.get(full);
                return { id, exists: data !== undefined, data: () => clone(data), ref: docRef(collPath, id) };
            },
            async set(data, opts = {}) {
                store.set(full, opts.merge ? { ...(store.get(full) || {}), ...clone(data) } : clone(data));
            },
            async update(updates) {
                if (!store.has(full)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
                store.set(full, applyUpdate(store.get(full), updates));
            },
            async delete() { store.delete(full); },
            collection: (name) => collectionRef(`${full}/${name}`),
        };
    };

    const query = (collPath, filters = [], order = null, max = null) => ({
        where: (field, op, value) => query(collPath, [...filters, [field, op, value]], order, max),
        orderBy: (field, dir = 'asc') => query(collPath, filters, [field, dir], max),
        limit: (n) => query(collPath, filters, order, n),
        select: () => query(collPath, filters, order, max),
        async get() {
            maybeFail(collPath);
            const prefix = `${collPath}/`;
            let docs = [...store.entries()]
                .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map(([k, data]) => ({ id: k.slice(prefix.length), data }));
            for (const [field, op, value] of filters) {
                if (op !== '==') throw new Error(`unsupported op ${op}`);
                docs = docs.filter((d) => d.data[field] === value);
            }
            if (order) {
                const [field, dir] = order;
                docs.sort((a, b) => String(a.data[field]).localeCompare(String(b.data[field])) * (dir === 'desc' ? -1 : 1));
            }
            if (max) docs = docs.slice(0, max);
            const snaps = docs.map((d) => ({ id: d.id, exists: true, data: () => clone(d.data), ref: docRef(collPath, d.id) }));
            return { docs: snaps, empty: snaps.length === 0, size: snaps.length };
        },
    });

    const collectionRef = (collPath) => ({
        ...query(collPath),
        doc: (id) => docRef(collPath, id),
        async add(data) {
            const id = nextId();
            store.set(`${collPath}/${id}`, clone(data));
            return docRef(collPath, id);
        },
    });

    return {
        store,
        collection: (name) => collectionRef(name),
        batch() {
            const ops = [];
            return {
                delete: (ref) => ops.push(() => ref.delete()),
                async commit() { for (const op of ops) await op(); },
            };
        },
        async listCollections() { return []; },
        // test helpers
        put(p, data) { store.set(p, clone(data)); },
        read(p) { return clone(store.get(p)); },
        reset() { store.clear(); failing.clear(); },
        failReads(name) { failing.add(name); },
    };
};

const install = () => {
    const db = createDb();
    const tokens = new Map(); // token -> uid
    const tokenErrors = new Map(); // token -> error thrown by verifyIdToken
    const createdUsers = [];
    const deletedFiles = [];
    const sentMail = [];

    const admin = {
        auth: () => ({
            async verifyIdToken(token) {
                if (tokenErrors.has(token)) throw tokenErrors.get(token);
                if (!tokens.has(token)) throw Object.assign(new Error('invalid token'), { code: 'auth/argument-error' });
                return { uid: tokens.get(token) };
            },
            async createUser(data) {
                createdUsers.push(data);
                return { uid: `new-${createdUsers.length}` };
            },
        }),
    };
    const storageBucket = { file: (p) => ({ delete: async () => { deletedFiles.push(p); } }) };
    const transporter = { sendMail: async (opts) => { sentMail.push(opts); } };

    const src = path.join(__dirname, '..', '..', 'src', 'config');
    const register = (file, exports) => {
        const filename = path.join(src, file);
        require.cache[filename] = { id: filename, filename, loaded: true, exports };
    };
    register('firebase.js', { admin, db, storageBucket });
    register('mailer.js', transporter);

    return {
        db,
        createdUsers,
        deletedFiles,
        sentMail,
        // Creates a user profile plus a token that resolves to it; rol null = auth account without profile
        user(uid, rol, extra = {}) {
            tokens.set(`tok-${uid}`, uid);
            if (rol) db.put(`users/${uid}`, { nombre: `N_${uid}`, apellido: `A_${uid}`, email: `${uid}@test.local`, rol, ...extra });
            return `tok-${uid}`;
        },
        // Makes verifyIdToken throw for this token (e.g. revoked session or Firebase outage)
        tokenError(token, error) { tokenErrors.set(token, error); },
        reset() {
            db.reset();
            tokens.clear();
            tokenErrors.clear();
            createdUsers.length = 0;
            deletedFiles.length = 0;
            sentMail.length = 0;
        },
    };
};

module.exports = { install };
