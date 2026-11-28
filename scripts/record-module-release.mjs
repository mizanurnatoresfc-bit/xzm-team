// Run with a trusted GitHub identity and the target Supabase project's service key.
// The explicit origin selects where evidence is written. The script never deploys.
import { execFileSync } from 'node:child_process'

const repository = 'mizanurnatoresfc-bit/xzm-team'
const [moduleId, prNumber, environment] = process.argv.slice(2)
const projectUrl = process.env.RELEASE_SUPABASE_URL
const serviceKey = process.env.RELEASE_SUPABASE_SERVICE_ROLE_KEY
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(moduleId ?? '') || !/^[1-9][0-9]*$/.test(prNumber ?? '')
    || !['preview', 'production'].includes(environment) || !projectUrl || !serviceKey) {
  throw new Error('Usage: node scripts/record-module-release.mjs MODULE PR preview|production with RELEASE_SUPABASE_URL and RELEASE_SUPABASE_SERVICE_ROLE_KEY')
}
const origin = new URL(projectUrl)
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') {
  throw new Error('RELEASE_SUPABASE_URL must be the HTTPS project origin')
}
const gh = path => JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', `repos/${repository}/${path}`], { encoding: 'utf8' }))
const pr = gh(`pulls/${prNumber}`)
if (pr.head.repo?.full_name !== repository) throw new Error('Release evidence requires a branch in the release repository')
const sha = environment === 'production' && pr.merged ? pr.merge_commit_sha : pr.head.sha
const workflows = ['website.yml', 'tests.yml'].map(file =>
  gh(`actions/workflows/${file}/runs?head_sha=${sha}&per_page=25`).workflow_runs
    .find(run => run.head_sha === sha && ['pull_request', 'push', 'workflow_dispatch'].includes(run.event)),
)
const tests = workflows.some(run => run?.status === 'completed' && run.conclusion !== 'success') ? 'failure'
  : workflows.every(run => run?.conclusion === 'success') ? 'success' : 'pending'
const testRun = workflows.find(Boolean)
if (!testRun) throw new Error('No matching Website or database workflow run for this commit')
const deployments = gh(`deployments?sha=${sha}&environment=${environment}&per_page=1`)
const deployment = deployments[0]
const deployStatus = deployment && gh(`deployments/${deployment.id}/statuses?per_page=1`)[0]?.state
const verified = deployStatus === 'success' && (environment !== 'production' || pr.merged)
const current = gh(`pulls/${prNumber}`)
if (current.head.sha !== pr.head.sha || current.merge_commit_sha !== pr.merge_commit_sha) throw new Error('PR changed while gathering evidence')
const response = await fetch(new URL('/rest/v1/rpc/module_release_record_evidence', origin), {
  method: 'POST',
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
  redirect: 'error',
  body: JSON.stringify({
    p_module: moduleId, p_pr: Number(prNumber), p_commit: sha, p_run: testRun.id, p_tests: tests,
    p_deployment: verified ? `${environment}_verified` : ['error', 'failure'].includes(deployStatus) ? 'failure' : 'pending',
  }),
})
if (!response.ok) throw new Error(`Evidence recording failed with HTTP ${response.status}`)
console.log(`${moduleId} · ${sha.slice(0, 8)} · tests ${tests} · deployment ${verified ? 'verified' : deployStatus ?? 'pending'}`)
