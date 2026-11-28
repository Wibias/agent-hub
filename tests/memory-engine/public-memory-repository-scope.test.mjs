import test from 'node:test';
import assert from 'node:assert/strict';
import { observePublicRepositoryScope } from '../../scripts/observe-public-memory-repository-scope.mjs';

const scope = {projectId:'github.com/example/repo', repositoryId:1234, branch:'feature/test', revisionSha:'a'.repeat(40)};
const repo = {id:1234, full_name:'Example/Repo', private:false, visibility:'public'};
const ref = {ref:'refs/heads/feature/test', object:{type:'commit',sha:scope.revisionSha}};
function fixture(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    assert.ok(responses.length, 'unexpected request');
    const value = responses.shift();
    return value instanceof Response ? value : Response.json(value);
  };
  return {calls, fetchImpl};
}

test('independent remote head observation is exact and never authorizes a claim', async () => {
  const {calls, fetchImpl} = fixture([repo, ref, repo]);
  const result = await observePublicRepositoryScope({...scope,fetchImpl});
  assert.equal(result.status,'observed_remote_head_matches');
  assert.equal(result.observedHeadSha, scope.revisionSha);
  assert.equal(result.repositoryId, scope.repositoryId);
  assert.equal(result.canonicalScopeVerified,false);
  assert.equal(result.localCheckoutVerified,false);
  assert.equal(result.claimAuthorized,false);
  assert.deepEqual(calls.map(c=>c.url), [
    'https://api.github.com/repos/example/repo',
    'https://api.github.com/repos/example/repo/git/ref/heads/feature/test',
    'https://api.github.com/repos/example/repo',
  ]);
  assert.ok(calls.every(c=>c.options.redirect==='error' && !c.options.headers.authorization));
});

test('foreign or changed repository identity, private repository and bad ref fail closed', async () => {
  for (const sequence of [
    [{...repo,id:99}], [{...repo,full_name:'other/repo'}], [{...repo,private:true}],
    [repo,{...ref,ref:'refs/tags/feature/test'}], [repo,{...ref,object:{...ref.object,type:'tag'}}],
    [repo,ref,{...repo,id:99}],
  ]) {
    await assert.rejects(observePublicRepositoryScope({...scope,...fixture(sequence)}), /remote_(repository|branch)_identity/);
  }
});

test('branch advancement is reported, not accepted as the pinned revision', async () => {
  const {fetchImpl} = fixture([repo,{...ref,object:{...ref.object,sha:'b'.repeat(40)}},repo]);
  const result = await observePublicRepositoryScope({...scope,fetchImpl});
  assert.equal(result.status,'observed_remote_head_differs');
  assert.equal(result.claimAuthorized,false);
});

test('bad input, redirects, unavailable and oversized responses deny', async () => {
  for (const bad of [{projectId:'github.com/example/..'}, {branch:'../../test'}, {branch:'a//b'}, {repositoryId:0}]) {
    const {calls,fetchImpl} = fixture([]);
    await assert.rejects(observePublicRepositoryScope({...scope,...bad,fetchImpl}), TypeError);
    assert.equal(calls.length,0);
  }
  for (const response of [new Response('',{status:302}),new Response('',{status:403}),new Response('x'.repeat(262145))]) {
    await assert.rejects(observePublicRepositoryScope({...scope,...fixture([response])}), /remote_scope_response_/);
  }
});
