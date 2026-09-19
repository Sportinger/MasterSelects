"""Pinned inventory provenance; Git reads never use the candidate as an oracle."""
from pathlib import Path
import copy
from functools import lru_cache
import hashlib
import json
import re
import subprocess

REVISION = '82631b1d2a58cdf33fe8256127adb9053294a9f3'
V1_SHA256 = '8ce27302d98d1c2f9104a6cf1afaca91399ee0c79e949238ebe6c05be8c38a5f'
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MANIFESTS = ROOT / 'tests/playwright/campaigns'
CONTRACT_PATHS = [
 'docs/Features/README.md', 'src/components/dock/DockPanelContent.tsx',
 'src/stores/dockStore/panelRegistry.ts',
 'src/components/panels/properties/propertiesPanelTypes.ts',
 'src/components/panels/properties/PropertiesClipTabStrip.tsx',
 'src/components/panels/properties/PropertiesClipTabContent.tsx',
 'src/components/panels/properties/index.tsx',
 'src/components/panels/properties/TransformTab.tsx',
 'src/routing/entryExperience.ts', 'src/RootApp.tsx', 'src/main.tsx',
]

def digest(data):
 return hashlib.sha256(data).hexdigest()

def historical():
 data = (MANIFESTS / 'windows-inventory.v1.json').read_bytes()
 if digest(data) != V1_SHA256:
  raise ValueError('historical v1 digest mismatch; frozen reference changed')
 return json.loads(data)

def references(m):
 for f in m['features']:
  if f['documentation']['path']:
   yield f['documentation'], 'sha256', 'documentation'
  for s in f['implementation']['sources']:
   yield s, 'sha256', 'implementation'
 for b in m['beta_checks']:
  yield b, 'source_sha256', 'beta'
 for s in m.get('provenance', {}).get('objects', []):
  yield s, 'sha256', 'contract/source'

def git_reader(repo):
 cache = {}
 def read(path):
  if path not in cache:
   result = subprocess.run(['git', '-C', str(repo), 'show', f'{REVISION}:{path}'], capture_output=True)
   if result.returncode:
    raise ValueError(f'pinned Git object unavailable: {REVISION}:{path}')
   cache[path] = result.stdout
  return cache[path]
 return read

def contracts(read):
 def txt(path): return read(path).decode('utf-8')
 def quoted(value): return re.findall(r"'([^']+)'", value)
 panels = re.findall(r"case '([^']+)':", txt(CONTRACT_PATHS[1]))
 registry = quoted(re.search(r'BUILT_IN_PANEL_TYPES[^=]*=\s*\[(.*?)\];',txt(CONTRACT_PATHS[2]),re.S)[1])
 properties = quoted(re.search(r'export type PropertiesTab\s*=(.*?);',txt(CONTRACT_PATHS[3]),re.S)[1])
 route = txt('src/routing/entryExperience.ts')
 route_arrays = {name:quoted(body) for name,body in re.findall(r'const (\w+_PATHS) = \[(.*?)\];',route)}
 return {'qualification':'Static declarations and source byte identity only; eligibility, routing behavior and UI reachability remain runtime-untested.',
  'panels':panels, 'registered_panels':registry, 'properties':properties,
  'property_host_mentions': sorted(set(re.findall(r"(?:activeTab === |setActiveTab\()'([^']+)'", '\n'.join(txt(p) for p in CONTRACT_PATHS[4:7])))),
  'live_embedded_in_transform': 'clip?.source?.liveInputId && <LiveInputTab clipId={clipId} embedded />' in txt(CONTRACT_PATHS[7]),
  'route_path_arrays':route_arrays,
  'entry_experiences':quoted(re.search(r'export type EntryExperience\s*=(.*?);',route,re.S)[1]),
  'landing_page_enabled':re.search(r'export const LANDING_PAGE_ENABLED = (\w+);',route)[1],
  'route_runtime_status':'runtime-untested',
  'route_scenario_gap':'No separately identified route scenarios in v1; entry-route runtime completion remains required.'}

@lru_cache(maxsize=2)
def exact_manifest(repo):
 m = copy.deepcopy(historical())
 read = git_reader(repo)
 paths = set(CONTRACT_PATHS)
 for obj,key,_ in references(m):
  paths.add(obj['path'])
  obj[key] = digest(read(obj['path']))
 m.update(schema_version='2.0.0', inventory_version='windows-inventory.v2',
  campaign_id='MS-CAMPAIGN-WINDOWS-FULL-INVENTORY-V2', task_id='AQ-010', plan_revision='AQ-R3',
  identity_basis='Exact raw pinned Git objects via read-only git show; no newline normalization or candidate references',
  scope_status='frozen-v2 provenance qualification; runtime campaign not started')
 m['provenance'] = {'revision':REVISION, 'historical_manifest_sha256':V1_SHA256,
  'historical_plan_sha256':m['plan_sha256'],
  'plan_hash_qualification':'Inherited AQ-005 plan identity; not asserted to be a pinned Git object.',
  'objects':[{'path':p,'sha256':digest(read(p))} for p in sorted(paths)]}
 m['source_contracts'] = contracts(read)
 return m

if __name__ == '__main__':
 import argparse
 parser=argparse.ArgumentParser(description='Generate v2 solely from pinned Git bytes and immutable v1 scope.')
 parser.add_argument('--git-repo',required=True)
 parser.add_argument('--output',required=True)
 args=parser.parse_args()
 Path(args.output).write_text(json.dumps(exact_manifest(args.git_repo),indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
