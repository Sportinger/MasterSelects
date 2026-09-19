"""Read-only static qualification. No editor, runtime test or release verdict."""
from pathlib import Path
import argparse
import json
import sys
from inventory_provenance import historical, exact_manifest, references, digest, contracts, REVISION

class Invalid(ValueError): pass

def require(ok, message):
 if not ok: raise Invalid(message)

def same(actual, expected, location):
 if type(actual) is not type(expected):
  raise Invalid(f'{location}: expected {type(expected).__name__}, got {type(actual).__name__}')
 if isinstance(expected,dict):
  require(set(actual)==set(expected),f'{location}: missing keys {sorted(set(expected)-set(actual))}; unexpected keys {sorted(set(actual)-set(expected))}')
  for k in expected: same(actual[k],expected[k],f'{location}.{k}')
 elif isinstance(expected,list):
  require(len(actual)==len(expected),f'{location}: coverage/length mismatch expected {len(expected)}, got {len(actual)}')
  for i,(a,e) in enumerate(zip(actual,expected)): same(a,e,f'{location}[{i}]')
 else:
  require(actual==expected,f'{location}: expected {expected!r}, got {actual!r}')

def validate(manifest, source_root, git_repo=None, read_override=None):
 m=json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
 root=Path(source_root).resolve()
 def read(path):
  resolved=(root/path).resolve()
  require(resolved.is_relative_to(root),f'path outside sourceRoot: {path}')
  try: return read_override(path) if read_override else resolved.read_bytes()
  except OSError as e: raise Invalid(f'missing/unreadable source: {path} ({e.__class__.__name__})') from e
 seen=set()
 for group in ['features','scenarios','surfaces','chapters','beta_checks','conflicts']:
  for row in m[group]:
   require(row['id'] not in seen,f'duplicate stable ID: {row["id"]} in {group}')
   seen.add(row['id'])
 version=m['inventory_version']
 require(version in ['windows-inventory.v1','windows-inventory.v2'],f'unsupported inventory_version: {version}')
 require(m['source_snapshot']==REVISION,'source_snapshot: wrong pinned revision')
 # Diagnose byte failures before semantic comparison; no universal-newline reads.
 checked={}
 for obj,key,kind in references(m):
  path=obj['path']; actual=digest(read(path))
  require(actual==obj[key],f'{kind} hash mismatch: {path}; expected {obj[key]}; actual {actual}; sourceRoot={root}')
  checked[path]=actual
 if version.endswith('.v2'):
  require(git_repo is not None,'v2 requires explicit --git-repo for independent pinned Git verification')
  expected=exact_manifest(git_repo)
 else: expected=historical()
 # Preserve ALL IDs, expectations, blockers, dimensions, gaps and non-runtime states.
 same(m,expected,'manifest')
 c=contracts(read)
 panels={s['name'] for s in m['surfaces'] if s['type']=='panel'}
 props={s['name'] for s in m['surfaces'] if s['type']=='properties'}
 require(panels==set(c['panels'])==set(c['registered_panels']),'panel coverage: inventory/render/registration differ')
 require(props==set(c['properties']),'Properties coverage: inventory/type contracts differ')
 require(props==set(c['property_host_mentions']),'Properties coverage: inventory/host mentions differ')
 require(c['live_embedded_in_transform'],'Properties live contract: embedded Transform control missing')
 docs=set(__import__('re').findall(r'\]\(\./([^\)]+\.md)\)',read('docs/Features/README.md').decode('utf-8')))
 require(docs=={Path(f['documentation']['path']).name for f in m['features'] if f['documentation']['path']},'documentation index coverage mismatch')
 if version.endswith('.v2'): same(c,m['source_contracts'],'source_contracts')
 return {'verdict':'STATIC_INVENTORY_VALID','manifest':str(Path(manifest).resolve()),'sourceRoot':str(root),
  'version':version,'unique_hashed_files':len(checked),'features':len(m['features']),
  'scenarios':len(m['scenarios']),'properties_contracts':len(props),'dock_panels':len(panels),
  'route_path_arrays':len(c['route_path_arrays']), 'runtime':'NOT_EXECUTED',
  'research_gate':False,'release_eligibility':False}

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--manifest',required=True)
 parser.add_argument('--source-root','--sourceRoot',dest='source_root',required=True)
 parser.add_argument('--git-repo')
 args=parser.parse_args()
 try: print(json.dumps(validate(args.manifest,args.source_root,args.git_repo),indent=2))
 except (ValueError,KeyError,TypeError,OSError) as e:
  print(f'INVALID_INVENTORY: {e}',file=sys.stderr); return 1
 return 0

if __name__=='__main__': sys.exit(main())
