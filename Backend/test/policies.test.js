const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isOwnUploadPath, escapeHtml, canAccessCase, canEditDiagnosis, canCloseCase } = require('../src/security/policies');

test('upload paths must be casos/<uid>/<nss>/<file> for the uploader and patient', () => {
    assert.equal(isOwnUploadPath('casos/u1/123/Ana-123-01-11-2026.dcm', 'u1', '123'), true);
    for (const bad of [
        'casos/u2/123/a.dcm',          // another user's folder
        'casos/u1/999/a.dcm',          // another patient
        'casos/u1/123/../x.dcm',       // traversal (extra segment)
        'casos/u1/123/..',             // traversal leaf
        'otros/u1/123/a.dcm',          // outside casos/
        'casos/u1/123/sub/a.dcm',      // nested
        'casos/u1/123/a b.dcm',        // unsafe characters
        undefined,
    ]) {
        assert.equal(isOwnUploadPath(bad, 'u1', '123'), false, String(bad));
    }
});

test('escapeHtml neutralizes markup and quotes', () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escapeHtml(undefined), '');
});

test('case policies', () => {
    const caso = { medicoGeneralId: 'g', medicoEspecialistaId: 'e' };
    assert.equal(canAccessCase({ uid: 'x', rol: 'administrador' }, caso), true);
    assert.equal(canAccessCase({ uid: 'g', rol: 'atencion' }, caso), true);
    assert.equal(canAccessCase({ uid: 'x', rol: 'medico' }, caso), false);
    assert.equal(canEditDiagnosis({ uid: 'e', rol: 'medico' }, caso), true);
    assert.equal(canEditDiagnosis({ uid: 'x', rol: 'administrador' }, caso), false);
    assert.equal(canCloseCase({ uid: 'x', rol: 'administrador' }, caso), true);
    assert.equal(canCloseCase({ uid: 'g', rol: 'atencion' }, caso), false);
});
