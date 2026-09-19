"""Bounded stdlib qualification; writes only fixtures/evidence inside this workspace."""
from pathlib import Path
import argparse
import copy
import json
import tempfile
import sys
from inventory_provenance import HERE, ROOT, MANIFESTS, CONTRACT_PATHS, historical, references, digest, exact_manifest
from validate_inventory import validate, Invalid

REPO='C:/Users/admin/Documents/MasterSelects'
ORIGINAL=Path(REPO)/'output/adaptive-quality/AQ-005/workspace'
EVIDENCE=HERE/'evidence'

def main():
 global EVIDENCE
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--git-repo', default=REPO)
 parser.add_argument('--original-source-root', default=str(ORIGINAL))
 parser.add_argument('--source-root', default=str(ROOT))
 args=parser.parse_args()
 repo=args.git_repo
 original_root=Path(args.original_source_root).resolve()
 source_root=Path(args.source_root).resolve()
 EVIDENCE.mkdir(parents=True,exist_ok=True)
 EVIDENCE=Path(tempfile.mkdtemp(prefix='qualification-run-',dir=EVIDENCE))
 results=[]
 v1=MANIFESTS/'windows-inventory.v1.json'; v2=MANIFESTS/'windows-inventory.v2.json'
 for label,manifest,root in [('v1-original-archive',v1,original_root),('v2-exact-git',v2,source_root)]:
  result=validate(manifest,root,repo)
  results.append({'check':label,'result':result})
 expected=exact_manifest(repo)
 original=historical()
 # Inspect every overlapping referenced file, not a newline assumption from one sample.
 byte_changes=[]
 old={o['path']:o[k] for o,k,_ in references(original)}
 for obj,key,kind in references(expected):
  path=obj['path']
  if path not in old or any(x['path']==path for x in byte_changes): continue
  a=(original_root/path).read_bytes(); b=(source_root/path).read_bytes()
  byte_changes.append({'path':path,'archive_sha256':digest(a),'git_sha256':digest(b),
   'changed':a!=b,'archive_crlf':a.count(b'\r\n'),'git_crlf':b.count(b'\r\n'),
   'equal_after_crlf_to_lf':a.replace(b'\r\n',b'\n')==b})
 (EVIDENCE/'byte-provenance.json').write_text(json.dumps(byte_changes,indent=2)+'\n',encoding='utf-8')
 with tempfile.TemporaryDirectory(prefix='qualification-',dir=EVIDENCE) as temporary:
  scratch=Path(temporary).resolve()
  if not scratch.is_relative_to(EVIDENCE.resolve()): raise RuntimeError('unsafe fixture root')
  paths={o['path'] for o,_,_ in references(expected)}|set(CONTRACT_PATHS)
  for path in paths:
   dest=scratch/path; dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((source_root/path).read_bytes())
  candidate=scratch/'candidate.json'
  def reject(name, m=None, expected_message=None):
   candidate.write_text(json.dumps(m or expected),encoding='utf-8')
   try: validate(candidate,scratch,repo)
   except (Invalid,ValueError) as e:
    message=str(e)
    if expected_message and expected_message not in message: raise AssertionError(f'{name}: wrong rejection: {message}')
    results.append({'check':name,'result':'REJECTED_AS_REQUIRED','failure':message})
   else: raise AssertionError(f'{name}: invalid inventory accepted')
  source=expected['features'][0]['implementation']['sources'][0]['path']
  doc=expected['features'][0]['documentation']['path']
  beta=expected['beta_checks'][0]['path']
  for name,path,mode,reason in [
   ('altered-source',source,'alter','implementation hash mismatch'),
   ('deleted-source',source,'delete','missing/unreadable source'),
   ('changed-documentation',doc,'alter','documentation hash mismatch'),
   ('deleted-documentation',doc,'delete','missing/unreadable source'),
   ('changed-beta-bytes',beta,'alter','hash mismatch'),
   ('changed-properties-contract','src/components/panels/properties/propertiesPanelTypes.ts','alter','hash mismatch'),
   ('changed-route-contract','src/routing/entryExperience.ts','alter','hash mismatch')]:
   target=scratch/path; saved=target.read_bytes()
   try:
    if mode=='delete': target.unlink()
    else: target.write_bytes(saved+b'\n// AQ-010 negative control\n')
    reject(name,expected_message=reason)
   finally: target.write_bytes(saved)
  mutations=[
   ('duplicate-feature-id',lambda m:m['features'][1].update(id=m['features'][0]['id']),'duplicate stable ID'),
   ('duplicate-beta-id',lambda m:m['beta_checks'][1].update(id=m['beta_checks'][0]['id']),'duplicate stable ID'),
   ('missing-feature-coverage',lambda m:m['features'].pop(),'coverage/length mismatch'),
   ('missing-scenario-coverage',lambda m:m['scenarios'].pop(),'coverage/length mismatch'),
   ('missing-properties-coverage',lambda m:m['surfaces'].pop(),'coverage/length mismatch'),
   ('removed-gap',lambda m:m['missing_integration'].pop(),'coverage/length mismatch'),
   ('removed-route-array',lambda m:m['source_contracts']['route_path_arrays'].pop('EDITOR_PATHS'),'missing keys'),
   ('runtime-green-injection',lambda m:m['runtime'].update(status='passed'),'manifest.runtime.status'),
   ('dimension-green-injection',lambda m:m['features'][0]['intended_dimensions']['create'].update(runtime_status='passed'),'runtime_status'),
   ('changed-expectation',lambda m:m['scenarios'][0].update(expected='always pass'),'expected'),
   ('wrong-revision',lambda m:m.update(source_snapshot='0'*40),'wrong pinned revision'),
  ]
  for name,mutate,message in mutations:
   m=copy.deepcopy(expected);mutate(m);reject(name,m,message)
  # A candidate cannot bless its own modified bytes by updating its references.
  target=scratch/source; saved=target.read_bytes();target.write_bytes(saved+b'\n// forged reference\n')
  m=copy.deepcopy(expected)
  for obj,key,_ in references(m):
   if obj['path']==source: obj[key]=digest(target.read_bytes())
  try: reject('candidate-rehashed-source',m,'sha256')
  finally: target.write_bytes(saved)
  validate(v2,scratch,repo)
  results.append({'check':'restored-fixtures','result':'STATIC_INVENTORY_VALID'})
 record={'task_id':'AQ-014','revision':'AQ-R3','command':'python tests/windows-quality/inventory/qualify_inventory.py',
  'arguments':vars(args),
  'checks':results,'runtime':'NOT_EXECUTED','release_eligibility':False,
  'v1_sha256':digest(v1.read_bytes()),'v2_sha256':digest(v2.read_bytes()),
  'provenance_files_compared':len(byte_changes),'newline_changed_files':sum(x['changed'] for x in byte_changes),
  'all_equal_after_crlf_to_lf':all(x['equal_after_crlf_to_lf'] for x in byte_changes)}
 (EVIDENCE/'qualification.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({k:v for k,v in record.items() if k!='checks'},indent=2))
 print(f'{len(results)} targeted checks completed; runtime NOT_EXECUTED')

if __name__=='__main__': main()
