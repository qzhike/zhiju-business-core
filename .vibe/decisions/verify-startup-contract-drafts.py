#!/usr/bin/env python3
"""Design-only checks. This is not a production report acceptor or Core service."""

import copy
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

HERE = Path(__file__).resolve().parent


def load(name):
    return json.loads((HERE / name).read_text())


def digest(value):
    return hashlib.sha256(value).hexdigest()


def stable_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def unique_index(items, key):
    result = {x[key]: x for x in items}
    require(len(result) == len(items), 'Duplicate ' + key)
    return result


REPORT_SCHEMA = load('runner-analysis-report-v0.2.schema.json')
UI_SCHEMA = load('workspace-startup-review-v0.1.schema.json')
REPORT = load('runner-analysis-report-v0.2.example.json')
MANIFEST = load('runner-analysis-report-v0.2.manifest.example.json')
EXAMPLES = load('workspace-startup-review-v0.1.examples.json')
CASES = load('runner-analysis-report-v0.2.candidate-cases.json')
RV = Draft202012Validator(REPORT_SCHEMA)
UV = Draft202012Validator(UI_SCHEMA)
CV = Draft202012Validator({'$ref': '#/$defs/startupCandidate', '$defs': REPORT_SCHEMA['$defs']})
REQUIRED = ['SC-POLICY', 'SC-PRODUCT', 'SC-MANAGEMENT', 'SC-APPLICABILITY', 'SC-PROFESSIONAL']
PATHS = {
    'ENTERPRISE_FACT': ['factType', 'value', 'riskLevel'],
    'PRODUCT': ['productType', 'displayName', 'intendedUse', 'productScope.productFamily',
                'productScope.variants', 'productScope.markets'],
    'QMS_APPLICABILITY': ['requirementSourceId', 'requirementLocator', 'outcome', 'rationale'],
    'QMS_MANAGEMENT_CHOICE': ['choiceKey', 'selectedOption', 'rationale'],
    'QMS_PROFESSIONAL_DECISION': ['decisionType', 'outcome', 'rationale'],
}


def field(value, path):
    for part in path.split('.'):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def check_candidate(candidate, evidence, sources, coverage, attention):
    CV.validate(candidate)
    ids = candidate['evidenceIds']
    require(set(ids) <= set(evidence), 'Dangling candidate evidence')
    require(set(candidate['relatedAttentionItemIds']) <= set(attention), 'Dangling candidate attention')
    kind, state = candidate['kind'], candidate['valueState']
    vals = [a['value'] for a in candidate['alternatives']] if state == 'CONFLICT' else [candidate['value']]
    missing = {p for p in PATHS[kind] if any(field(v, p) is None for v in vals)}
    require(missing == set(candidate['missingFields']), 'Missing field paths do not match values')
    if state == 'CONFLICT':
        all_evidence = {eid for a in candidate['alternatives'] for eid in a['evidenceIds']}
        require(all_evidence == set(ids), 'Conflict evidence does not match alternatives')
        actual = {p for p in PATHS[kind] if p != 'rationale'
                  if len({json.dumps(field(v, p), sort_keys=True) for v in vals
                          if field(v, p) is not None}) > 1}
        require(actual == set(candidate['conflictingFields']), 'Conflict fields must actually differ')
    if state != 'EVIDENCED':
        expected_kinds = {'SOURCE_CONFLICT', 'PROTECTION_CONFLICT', 'FACT_QUESTION'} if state == 'CONFLICT' else {
            'MISSING_MATERIAL', 'UNREAD_MATERIAL', 'UNREADABLE_MATERIAL', 'PARTIAL_MATERIAL', 'FACT_QUESTION'}
        require(any(attention[x]['kind'] in expected_kinds for x in candidate['relatedAttentionItemIds']),
                'Candidate issue has the wrong kind')
    bundles = candidate['alternatives'] if state == 'CONFLICT' else [{'value': candidate['value'], 'evidenceIds': ids}]
    for bundle in bundles:
        for eid in bundle['evidenceIds']:
            require(eid in evidence, 'Dangling alternative evidence')
            source = evidence[eid]['sourceId']
            require(source in sources, 'Evidence source outside authorized fixture set')
            if sources[source]['role'] in {'CUSTOMER_MATERIAL', 'TEMPLATE'}:
                require(coverage.get(source) in {'READ', 'PARTIAL'}, 'Candidate uses an unread source')
        if bundle['value'] is None:
            continue
        requires_customer = kind != 'QMS_APPLICABILITY' or field(bundle['value'], 'outcome') is not None
        if requires_customer:
            require(any(sources[evidence[eid]['sourceId']]['role'] in {'CUSTOMER_MATERIAL', 'TRUSTED_DECISION_INPUT'}
                        for eid in bundle['evidenceIds']), 'Template cannot prove a customer value')
        if kind == 'QMS_APPLICABILITY' and 'requirementSourceId' in bundle['value']:
            source = bundle['value']['requirementSourceId']
            require(source in sources and sources[source]['role'] == 'TEMPLATE', 'Invalid requirement source')


def check_report(report=REPORT, manifest=MANIFEST):
    RV.validate(report)
    sources = unique_index(manifest['sources'], 'sourceId')
    coverage = unique_index(report['readCoverage'], 'sourceId')
    require(set(coverage) == {k for k, v in sources.items() if v['role'] in {'CUSTOMER_MATERIAL', 'TEMPLATE'}},
            'Read coverage must match customer/template source set')
    require(report['context']['inputManifestSha256'] == digest(stable_bytes(manifest)), 'Input set hash mismatch')
    for source in sources.values():
        path = (HERE / source['relativePath']).resolve()
        require(path.parent == HERE, 'Fixture source path escaped directory')
        require(digest(path.read_bytes()) == source['sha256'], 'Fixture source bytes changed')
    evidence = unique_index(report['evidence'], 'id')
    for e in evidence.values():
        require(e['sourceId'] in sources, 'Evidence source not in manifest')
        if e['quote'] is not None and e['representation'] == 'ORIGINAL':
            require(e['quote'] in (HERE / sources[e['sourceId']]['relativePath']).read_text(), 'Fixture quote mismatch')
    attention = unique_index(report['attentionItems'], 'id')
    candidates = unique_index(report['startupCandidates'], 'candidateId')
    files = unique_index(report['plannedFiles'], 'id')
    changes = unique_index(report['changes'], 'id')
    protected = unique_index(report['protectedFacts'], 'id')
    for item in attention.values():
        for key, target in [('evidenceIds', evidence), ('affectedPlannedFileIds', files),
                            ('relatedChangeIds', changes), ('protectedFactIds', protected)]:
            require(set(item[key]) <= set(target), 'Dangling attention ' + key)
    for c in candidates.values():
        check_candidate(c, evidence, sources, {k: v['readState'] for k, v in coverage.items()}, attention)
    for f in files.values():
        require(set(f['customerSourceIds']) <= {k for k, s in sources.items() if s['role'] == 'CUSTOMER_MATERIAL'},
                'Invalid customer file source')
        require(set(f['templateSourceIds']) <= {k for k, s in sources.items() if s['role'] == 'TEMPLATE'},
                'Invalid template file source')
        require(set(f['attentionItemIds']) <= set(attention), 'Dangling file attention')
    for change in changes.values():
        for key, target in [('targetPlannedFileIds', files), ('evidenceIds', evidence),
                            ('protectedFactIds', protected), ('attentionItemIds', attention),
                            ('dependsOnChangeIds', changes)]:
            require(set(change[key]) <= set(target), 'Dangling change ' + key)
    path = (HERE / report['narrative']['relativePath']).resolve()
    require(path.parent == HERE and digest(path.read_bytes()) == report['narrative']['sha256'], 'Narrative hash mismatch')
    # This fixture renderer embeds the body verbatim; production rendering remains separate work.
    embedded = path.read_text().split('```json\n', 1)[1].split('\n```', 1)[0]
    require(json.loads(embedded) == {k: v for k, v in report.items() if k != 'narrative'}, 'Narrative body drift')


def same_project(reference, binding):
    require(reference['scope'] == binding['projectRef']['scope'], 'Cross-project reference')


def check_binding(binding):
    project = binding['projectRef']
    require(project['scope'].get('projectId') == project['objectId'], 'Project identity/scope mismatch')
    for key in ['reportRef', 'candidateSetRef', 'planRef']:
        same_project(binding[key], binding)
    for key, object_type in [('projectRef', 'design.project'), ('reportRef', 'design.analysis_report'),
                             ('candidateSetRef', 'design.startup_candidate_set'),
                             ('planRef', 'design.upgrade_plan'), ('ruleBundleRef', 'design.rule_bundle')]:
        require(binding[key]['objectType'] == object_type, 'Wrong fixture reference kind')
    rules = binding['ruleBundleRef']['scope']
    require(rules == {} or (rules.get('enterpriseId') == project['scope']['enterpriseId']
                           and rules.get('projectId') in {None, project['objectId']}), 'Invalid rule scope')
    require(binding['reportJsonSha256'] == digest((HERE / 'runner-analysis-report-v0.2.example.json').read_bytes()),
            'Report JSON bytes mismatch')
    require(binding['inputManifestSha256'] == REPORT['context']['inputManifestSha256'], 'Report input mismatch')


def check_view(view, required=REQUIRED):
    UV.validate(view)
    check_binding(view['binding'])
    candidates = unique_index(view['candidateReviews'], 'candidateId')
    report_candidates = unique_index(REPORT['startupCandidates'], 'candidateId')
    require(set(candidates) == set(report_candidates), 'Projection candidates mismatch')
    for cid, c in candidates.items():
        original = report_candidates[cid]
        require(all(c[k] == original[k] for k in ['kind', 'valueState', 'evidenceIds']), 'Candidate status drift')
        display = unique_index(c['displayFields'], 'path')
        require(set(display) == set(PATHS[c['kind']]), 'Incomplete candidate detail fields')
        for path, detail in display.items():
            value = field(original['value'], path)
            if isinstance(value, list):
                value = '、'.join(value)
            elif isinstance(value, dict):
                value = value['text'] if value.get('format') == 'TEXT' else json.dumps(value, ensure_ascii=False)
            require(detail['value'] == value, 'Displayed value differs from candidate')
        require(not c['alternatives'], 'Fixture non-conflicting candidate cannot have display alternatives')
    groups = unique_index(view['informationGroups'], 'group')
    require(set(groups) == {'PROFILE', 'QMS', 'PRODUCT_SCOPE'}, 'Information groups must appear once')
    grouped = [cid for g in groups.values() for cid in g['candidateIds']]
    require(len(grouped) == len(set(grouped)) and set(grouped) == set(candidates), 'Missing/duplicate group candidates')
    for group, g in groups.items():
        require(all(('PROFILE' if candidates[c]['kind'] == 'ENTERPRISE_FACT' else
                     'PRODUCT_SCOPE' if candidates[c]['kind'] == 'PRODUCT' else 'QMS') == group
                    for c in g['candidateIds']), 'Candidate assigned to wrong information group')
    require(set(view['requiredCandidateIds']) == set(required), 'Server fixture policy mismatch')
    require(set(required) <= set(candidates), 'Required candidate missing')
    evidenced = {cid for cid, c in candidates.items() if c['valueState'] == 'EVIDENCED'}
    require(set(view['confirmationCandidateIds']) == evidenced, 'Unknown/conflict cannot be confirmed')
    evidence = unique_index(view['evidenceViews'], 'evidenceId')
    require(set(evidence) == {e['id'] for e in REPORT['evidence']}, 'Evidence projection mismatch')
    for e in evidence.values():
        original = next(x for x in REPORT['evidence'] if x['id'] == e['evidenceId'])
        source = next(s for s in MANIFEST['sources'] if s['sourceId'] == original['sourceId'])
        require(e['role'] == source['role'] and e['quote'] == original['quote']
                and e['locator'] == original['locator']['value'], 'Evidence projection changed role or content')
        if e['role'] == 'CUSTOMER_MATERIAL':
            same_project(e['sourceRef'], view['binding'])
        else:
            s = e['sourceRef']['scope']
            require(s == {} or s.get('enterpriseId') == view['binding']['projectRef']['scope']['enterpriseId'],
                    'Unauthorized shared source scope')
    files = unique_index(view['plannedFiles'], 'plannedFileId')
    require(set(files) == {f['id'] for f in REPORT['plannedFiles']}, 'Plan projection mismatch')
    blockers = view['blockers']
    for b in blockers:
        require(set(b['candidateIds']) <= set(candidates) and set(b['plannedFileIds']) <= set(files), 'Dangling blocker')
        require(set(b['attentionItemIds']) <= {x['id'] for x in REPORT['attentionItems']}, 'Dangling blocker attention')
        if b['scope'] == 'FILE':
            require(bool(b['plannedFileIds']), 'File blocker needs a target')
    for fid, f in files.items():
        expected = {c['id'] for c in REPORT['changes'] if fid in c['targetPlannedFileIds']}
        require(set(f['changeIds']) == expected, 'Incomplete whole-file change plan')
        affected = [a for a in REPORT['attentionItems'] if fid in a['affectedPlannedFileIds']
                    and a['effect'] == 'BEFORE_AFFECTED_GENERATION']
        if affected:
            require(f['processingCondition'] == 'BLOCKED', 'Affected file cannot be eligible')
            require(any(b['scope'] == 'FILE' and fid in b['plannedFileIds'] for b in blockers), 'Missing visible file reason')
    unknown_required = set(required) - evidenced
    global_blockers = [b for b in blockers if b['scope'] == 'PROJECT_START']
    if unknown_required:
        require(unknown_required <= {cid for b in global_blockers for cid in b['candidateIds']}, 'Missing required-info blocker')
    if 'CONFIRM_AND_START' in view['allowedActions']:
        require(view['projectState'] == 'PREPARING' and not global_blockers and not unknown_required,
                'Start action must satisfy state and required information')


def check_request(request, view=EXAMPLES['view'], can_confirm=True):
    UV.validate(request)
    check_view(view)
    require(can_confirm, 'Trusted fixture permission denied')
    require('CONFIRM_AND_START' in view['allowedActions'], 'Action not allowed')
    require(request['binding'] == view['binding'], 'Stale report/CAS/plan/rules binding')
    require(set(request['confirmedCandidateIds']) == set(view['confirmationCandidateIds']), 'Confirmation set mismatch')
    eligible = {f['plannedFileId'] for f in view['plannedFiles'] if f['processingCondition'] == 'ELIGIBLE'}
    require(set(request['selectedPlannedFileIds']) <= eligible, 'Blocked or unavailable file selected')


def check_receipt(receipt, request=EXAMPLES['request']):
    UV.validate(receipt)
    check_binding(receipt['binding'])
    for key in ['binding', 'idempotencyKey', 'confirmedCandidateIds', 'selectedPlannedFileIds']:
        require(receipt[key] == request[key], 'Receipt changed original intent: ' + key)
    same_project(receipt['requestRef'], receipt['binding'])
    info, start, scope = receipt['information']['state'], receipt['startup']['state'], receipt['scope']['state']
    status, recovery = receipt['status'], set(receipt['allowedRecoveryActions'])
    if info == 'CONFIRMED':
        for decision in receipt['information']['decisionRefs']:
            same_project(decision, receipt['binding'])
    if start == 'STARTED':
        require(info == 'CONFIRMED' and receipt['projectState'] == 'ACTIVE', 'Startup must follow confirmation')
        for r in receipt['startup']['startSnapshot'].values():
            s = r['scope']
            require(s.get('enterpriseId') == receipt['binding']['projectRef']['scope']['enterpriseId']
                    and s.get('projectId') in {None, receipt['binding']['projectRef']['objectId']}, 'Startup enterprise mismatch')
    elif start == 'NOT_STARTED':
        require(receipt['projectState'] == 'PREPARING', 'Known unstarted project cannot be ACTIVE')
    if scope in {'RECEIVED', 'UNKNOWN'}:
        require(start == 'STARTED', 'Scope attempt must follow known startup')
    if scope == 'RECEIVED':
        same_project(receipt['scope']['workScopeRef'], receipt['binding'])
    if start == 'UNKNOWN':
        require(info == 'CONFIRMED', 'Unknown startup needs confirmed information')
    if info == 'UNKNOWN':
        require(start == 'NOT_STARTED' and scope == 'NOT_RECEIVED', 'Unknown confirmation cannot imply later success')
    states = (info, start, scope)
    if status == 'ACCEPTED':
        require(states == ('CONFIRMED', 'STARTED', 'RECEIVED') and not recovery and not receipt['reasons'],
                'Accepted must have three known successes')
    elif status == 'PARTIAL':
        require(info == 'CONFIRMED' and scope == 'NOT_RECEIVED' and 'UNKNOWN' not in states
                and recovery == {'RETRY_INCOMPLETE_STEP'}, 'Partial recovery must preserve successful steps')
    elif status == 'UNKNOWN':
        require('UNKNOWN' in states and recovery == {'READ_ORIGINAL'}, 'Unknown may only read original request')
    elif status == 'FAILED':
        require(states == ('NOT_CONFIRMED', 'NOT_STARTED', 'NOT_RECEIVED')
                and recovery == {'RECHECK_CURRENT_INPUTS'}, 'Failed cannot erase completed work')
    elif status == 'STALE':
        require('UNKNOWN' not in states and scope == 'NOT_RECEIVED' and recovery == {'RECHECK_CURRENT_INPUTS'},
                'Stale must retain known completed facts and recheck')
    elif status == 'PENDING':
        require(scope == 'NOT_RECEIVED' and 'UNKNOWN' not in states and recovery == {'READ_ORIGINAL'},
                'Pending reads original request')
    if status not in {'ACCEPTED', 'PENDING'}:
        require(bool(receipt['reasons']), 'Failure/recovery needs a visible reason')


def check_recovery(request, receipt):
    UV.validate(request)
    check_receipt(receipt)
    require(request['requestRef'] == receipt['requestRef'] and request['idempotencyKey'] == receipt['idempotencyKey'],
            'Recovery must target original intent')
    require(request['action'] in receipt['allowedRecoveryActions'], 'Recovery action not allowed')


def changed(value, transform):
    result = copy.deepcopy(value)
    transform(result)
    return result


passed = []


def accept(name, function):
    function()
    passed.append(name)


def reject(name, function):
    try:
        function()
    except (ValueError, ValidationError):
        passed.append(name)
    else:
        raise AssertionError('Unexpected acceptance: ' + name)


def run():
    Draft202012Validator.check_schema(REPORT_SCHEMA)
    Draft202012Validator.check_schema(UI_SCHEMA)
    legacy = load('runner-analysis-report-v0.1.schema.json')
    require(all(REPORT_SCHEMA['$defs'][k] == v for k, v in legacy['$defs'].items()), 'Legacy definition changed')
    require(REPORT_SCHEMA['allOf'] == legacy['allOf'], 'Legacy root constraints changed')
    require(all(REPORT_SCHEMA['properties'][k] == v for k, v in legacy['properties'].items()
                if k != 'schemaVersion'), 'Legacy property constraints changed')
    passed.append('all v0.1 definitions and constraints retained in draft v0.2')
    accept('report, sources, hashes and same-body narrative', check_report)
    accept('three compact information groups and optional unknown', lambda: check_view(EXAMPLES['view']))
    accept('full-file confirmation request', lambda: check_request(EXAMPLES['request']))
    for name in ['acceptedReceipt', 'partialReceipt', 'unknownReceipt', 'failedReceipt', 'staleReceipt']:
        accept(name, lambda name=name: check_receipt(EXAMPLES[name]))
    accept('unknown readback', lambda: check_recovery(EXAMPLES['recoveryRequest'], EXAMPLES['unknownReceipt']))
    retry = changed(EXAMPLES['recoveryRequest'], lambda x: x.update(action='RETRY_INCOMPLETE_STEP'))
    accept('partial retry continues only unfinished step', lambda: check_recovery(retry, EXAMPLES['partialReceipt']))
    stale_active = changed(EXAMPLES['partialReceipt'], lambda x: x.update(status='STALE', allowedRecoveryActions=['RECHECK_CURRENT_INPUTS']))
    accept('stale after startup preserves ACTIVE and exact startup refs', lambda: check_receipt(stale_active))
    pending = changed(EXAMPLES['failedReceipt'], lambda x: x.update(status='PENDING', reasons=[], allowedRecoveryActions=['READ_ORIGINAL']))
    accept('pending retains original request for readback', lambda: check_receipt(pending))

    evidence = unique_index(REPORT['evidence'], 'id')
    sources = unique_index(MANIFEST['sources'], 'sourceId')
    coverage = {s['sourceId']: 'READ' for s in MANIFEST['sources']}
    attention = unique_index(REPORT['attentionItems'], 'id')
    attention['U-PRODUCT'] = {'kind': 'FACT_QUESTION'}
    attention['U-MANAGEMENT-CONFLICT'] = {'kind': 'SOURCE_CONFLICT'}
    evidence['E-ALTERNATE'] = CASES['additionalEvidence']
    sources['C-ALTERNATE'] = CASES['additionalSource']
    coverage['C-ALTERNATE'] = 'READ'
    alt = CASES['additionalSource']
    require(digest((HERE / alt['relativePath']).read_bytes()) == alt['sha256'], 'Additional source hash mismatch')
    require(CASES['additionalEvidence']['quote'] in (HERE / alt['relativePath']).read_text(), 'Additional source quote mismatch')
    check_c = lambda c: check_candidate(c, evidence, sources, coverage, attention)
    for name in ['partialProduct', 'managementConflict', 'professionalProposal']:
        accept(name + ' candidate shape and binding', lambda name=name: check_c(CASES[name]))

    c0, c1 = REPORT['startupCandidates'][:2]
    reject('Runner cannot assert approval', lambda: CV.validate(changed(c0, lambda x: x.update(approved=True))))
    reject('Runner cannot assert startup requirements', lambda: CV.validate(changed(c0, lambda x: x.update(mandatoryForStartup=True))))
    reject('name-only product is not evidenced', lambda: check_c(changed(c1, lambda x: x.update(value={'displayName': '系列甲'}))))
    reject('template-only product', lambda: check_c(changed(c1, lambda x: x.update(evidenceIds=['E-TEMPLATE']))))
    reject('dangling evidence alias', lambda: check_c(changed(c0, lambda x: x.update(evidenceIds=['E-ABSENT']))))
    reject('unknown cannot silently discard known required fields', lambda: check_c(changed(CASES['partialProduct'], lambda x: x['value'].pop('intendedUse'))))
    reject('false field conflict', lambda: check_c(changed(CASES['managementConflict'], lambda x: x['alternatives'][1].update(value=copy.deepcopy(x['alternatives'][0]['value'])))))
    reject('unread evidence cannot support candidate', lambda: check_candidate(c0, evidence, sources, {**coverage, 'C-STARTUP': 'UNREAD'}, attention))

    view, request, accepted = EXAMPLES['view'], EXAMPLES['request'], EXAMPLES['acceptedReceipt']
    reject('required unknown has a visible startup blocker', lambda: check_view(changed(view, lambda x: x['requiredCandidateIds'].append('SC-SOFTWARE')), REQUIRED + ['SC-SOFTWARE']))
    blocked_view = copy.deepcopy(view)
    blocked_view['requiredCandidateIds'].append('SC-SOFTWARE')
    blocked_view['blockers'].append({'scope': 'PROJECT_START', 'reason': '软件信息是本测试规则的必要项。',
                                    'candidateIds': ['SC-SOFTWARE'], 'plannedFileIds': [], 'attentionItemIds': ['U-SOFTWARE']})
    blocked_view['allowedActions'] = ['VIEW_ONLY']
    accept('required unknown explicitly blocks startup', lambda: check_view(blocked_view, REQUIRED + ['SC-SOFTWARE']))
    reject('required unknown cannot expose start action', lambda: check_view(changed(blocked_view, lambda x: x.update(allowedActions=['CONFIRM_AND_START'])), REQUIRED + ['SC-SOFTWARE']))
    reject('blocked whole file cannot become eligible', lambda: check_view(changed(view, lambda x: x['plannedFiles'][3].update(processingCondition='ELIGIBLE'))))
    reject('details cannot hide intended use', lambda: check_view(changed(view, lambda x: x['candidateReviews'][1]['displayFields'].pop(2))))
    reject('evidence cannot relabel customer as template', lambda: check_view(changed(view, lambda x: x['evidenceViews'][0].update(role='TEMPLATE'))))
    reject('confirmation cannot include unknown', lambda: check_request(changed(request, lambda x: x['confirmedCandidateIds'].append('SC-SOFTWARE'))))
    reject('blocked file cannot be selected', lambda: check_request(changed(request, lambda x: x['selectedPlannedFileIds'].append('F-ROLE'))))
    reject('empty selection', lambda: check_request(changed(request, lambda x: x.update(selectedPlannedFileIds=[]))))
    reject('client cannot submit change subset', lambda: check_request(changed(request, lambda x: x.update(changeIds=['CH-F-CORR']))))
    reject('client cannot choose runtime', lambda: check_request(changed(request, lambda x: x.update(runtime='claude-code'))))
    reject('client cannot claim Human identity', lambda: check_request(changed(request, lambda x: x.update(approvedBy='human'))))
    reject('withdrawn permission', lambda: check_request(request, can_confirm=False))
    for field_name in ['reportRef', 'candidateSetRef', 'planRef', 'ruleBundleRef']:
        reject('stale ' + field_name, lambda field_name=field_name: check_request(changed(request, lambda x: x['binding'][field_name].update(snapshotId='019a0000-0000-7000-8000-000000000fff'))))
    reject('stale CAS', lambda: check_request(changed(request, lambda x: x['binding'].update(projectVersion=2))))
    reject('cross-project report', lambda: check_view(changed(view, lambda x: x['binding']['reportRef']['scope'].update(projectId='019a0000-0000-7000-8000-000000000fff'))))
    reject('cross-project customer evidence', lambda: check_view(changed(view, lambda x: x['evidenceViews'][0]['sourceRef']['scope'].update(projectId='019a0000-0000-7000-8000-000000000fff'))))
    reject('ACTIVE cannot be started again', lambda: check_view(changed(view, lambda x: x.update(projectState='ACTIVE'))))
    reject('accepted requires scope receipt', lambda: check_receipt(changed(accepted, lambda x: x.update(scope={'state': 'NOT_RECEIVED'}))))
    reject('partial success cannot masquerade as failure', lambda: check_receipt(changed(EXAMPLES['partialReceipt'], lambda x: x.update(status='FAILED'))))
    reject('unknown cannot retry', lambda: check_recovery(retry, EXAMPLES['unknownReceipt']))
    reject('startup refs cannot cross enterprise', lambda: check_receipt(changed(accepted, lambda x: x['startup']['startSnapshot']['productScopeSnapshotRef']['scope'].update(enterpriseId='019a0000-0000-7000-8000-000000000fff'))))
    reject('receipt must preserve original selection', lambda: check_receipt(changed(accepted, lambda x: x.update(selectedPlannedFileIds=['F-CORR']))))
    reject('recovery cannot switch intent key', lambda: check_recovery(changed(EXAMPLES['recoveryRequest'], lambda x: x.update(idempotencyKey='NEW-INTENT')), EXAMPLES['unknownReceipt']))
    reject('recovery cannot change files', lambda: check_recovery(changed(EXAMPLES['recoveryRequest'], lambda x: x.update(selectedPlannedFileIds=['F-ROLE'])), EXAMPLES['unknownReceipt']))
    reject('evidence projection has no server path', lambda: UV.validate(changed(view, lambda x: x['evidenceViews'][0].update(serverPath='/srv/private/customer.docx'))))
    print(json.dumps({'status': 'PASS', 'scenarioCount': len(passed), 'scope': 'DESIGN_FIXTURES_ONLY',
                      'productionRunner': 'NOT RUN', 'coreApi': 'NOT RUN', 'persistence': 'NOT RUN'}, ensure_ascii=False))


if __name__ == '__main__':
    run()
