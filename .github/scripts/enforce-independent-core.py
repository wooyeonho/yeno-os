from pathlib import Path
import re


def replace_once_or_present(path, old, new):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement, found {count}')
    file.write_text(text.replace(old, new), encoding='utf-8')


def regex_replace_once_or_present(path, pattern, new, present):
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if present in text:
        return
    updated, count = re.subn(pattern, new, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex replacement, found {count}')
    file.write_text(updated, encoding='utf-8')


replace_once_or_present(
    'runtime/lib/provider-config.mjs',
    "  return {...config, auto: env.YENO_AGENT_AUTORUN === 'true', selectionMode: automatic ? 'configured-order' : 'explicit',",
    "  // Credentials remain available for owner-triggered calls, but a configured key\n  // never authorizes background model work by the operating core.\n  return {...config, auto:false, backgroundModelCalls:false, selectionMode: automatic ? 'configured-order' : 'explicit',",
)

replace_once_or_present(
    'runtime/lib/agent.mjs',
    "  if(!config.ready||!config.auto||!state.modules.ai||state.emergencyStop)return null;",
    "  if(config.backgroundModelCalls===false||!config.ready||!config.auto||!state.modules.ai||state.emergencyStop)return null;",
)

replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "function aiAvailable(ctx){return !!ctx.config.ready&&ctx.aiUsedToday<ctx.settings.dailyAiLimit&&ctx.globalUsedToday<ctx.globalLimit;}",
    "const backgroundModelCallsAllowed=ctx=>ctx.config.backgroundModelCalls!==false;\nfunction aiAvailable(ctx){return backgroundModelCallsAllowed(ctx)&&!!ctx.config.ready&&ctx.aiUsedToday<ctx.settings.dailyAiLimit&&ctx.globalUsedToday<ctx.globalLimit;}",
)

# Only step 2 with a persisted draft is a local-only recovery checkpoint. A
# settled provider response at an earlier step is not enough: resuming it may
# still collect evidence, rebuild prompts, or invoke the provider again.
replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "    // A settled answer can finish locally. Any path that would create a new\n    // provider call needs explicit background authorization, which production\n    // provider configuration deliberately never grants.\n    if(finalAnswer)return true;\n    return backgroundModelCallsAllowed(ctx)&&!!ctx.config.ready&&calls(job).length===0&&aiAvailable(ctx);",
    "    if(!backgroundModelCallsAllowed(ctx))return false;\n    return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);",
)
replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "    return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);",
    "    if(!backgroundModelCallsAllowed(ctx))return false;\n    return !!ctx.config.ready&&(calls(job).length===0?aiAvailable(ctx):finalAnswer);",
)

replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "  if(!ctx.config.ready)blockers.unshift({id:'model',title:'연구 모델 연결',reason:'선택한 제공자의 키·모델·호출 한도 연결이 필요합니다.'});\n  if(ctx.aiUsedToday>=ctx.settings.dailyAiLimit||ctx.globalUsedToday>=ctx.globalLimit)blockers.unshift({id:'budget',title:'오늘 모델 호출 한도',reason:'자율 실행 또는 전체 호출 한도에 도달했습니다. 미확인·예약 호출도 포함하며 UTC 날짜가 바뀐 뒤 다시 확인합니다.'});",
    "  if(!backgroundModelCallsAllowed(ctx))blockers.unshift({id:'model-policy',title:'AI 호출 정책 · 명시적 실행만',reason:'독립 운영 코어는 백그라운드에서 모델을 호출하지 않습니다. 질문·음성·연구·코딩을 연호님이 직접 실행한 경우에만 연결된 AI를 사용합니다.'});\n  else if(!ctx.config.ready)blockers.unshift({id:'model',title:'연구 모델 연결',reason:'선택한 제공자의 키·모델·호출 한도 연결이 필요합니다.'});\n  if(backgroundModelCallsAllowed(ctx)&&(ctx.aiUsedToday>=ctx.settings.dailyAiLimit||ctx.globalUsedToday>=ctx.globalLimit))blockers.unshift({id:'budget',title:'오늘 모델 호출 한도',reason:'자율 실행 또는 전체 호출 한도에 도달했습니다. 미확인·예약 호출도 포함하며 UTC 날짜가 바뀐 뒤 다시 확인합니다.'});",
)
replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "    if(ctx.config.ready&&ctx.tracks.some(track=>track.status==='ready')){",
    "    if(backgroundModelCallsAllowed(ctx)&&ctx.config.ready&&ctx.tracks.some(track=>track.status==='ready')){",
)
replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "    summary=ctx.tracks.every(track=>['validation','blocked'].includes(track.status))?'연구 초안의 자동 반복을 멈추고 실제 검증 자료를 기다립니다. 공개 재난 관측은 설정에 따라 계속합니다.':'호출 한도와 실행 간격을 지키며 다음 작업을 기다립니다.';",
    "    summary=!backgroundModelCallsAllowed(ctx)?'독립 운영 모드입니다. 규칙·스케줄러·저장된 기능으로 계속 동작하며, AI는 연호님이 명시적으로 실행할 때만 호출합니다.':ctx.tracks.every(track=>['validation','blocked'].includes(track.status))?'연구 초안의 자동 반복을 멈추고 실제 검증 자료를 기다립니다. 공개 재난 관측은 설정에 따라 계속합니다.':'호출 한도와 실행 간격을 지키며 다음 작업을 기다립니다.';",
)
replace_once_or_present(
    'runtime/lib/autopilot.mjs',
    "  return {mind:motivationStatus(state,rankedCandidates(state,ctx),decision,ctx.at),enabled:ctx.settings.enabled,dailyAiLimit:ctx.settings.dailyAiLimit,aiUsedToday:ctx.aiUsedToday,globalLimit:ctx.globalLimit,globalUsedToday:ctx.globalUsedToday,activeJobId:active?.id??null,nextAt,summary,tracks:ctx.tracks.map(({code,name,phase,status,reason,lastJobId})=>({code,name,phase,status,reason,lastJobId})),blockers,recentJobs:[...ctx.jobs].sort((a,b)=>created(b)-created(a)).slice(0,12).map(job=>job.id),lastError:ctx.settings.lastError};",
    "  const backgroundModelCalls=backgroundModelCallsAllowed(ctx);\n  return {mind:motivationStatus(state,rankedCandidates(state,ctx),decision,ctx.at),enabled:ctx.settings.enabled,modelPolicy:backgroundModelCalls?'background-authorized':'explicit-only',backgroundModelCalls,dailyAiLimit:ctx.settings.dailyAiLimit,aiUsedToday:ctx.aiUsedToday,globalLimit:ctx.globalLimit,globalUsedToday:ctx.globalUsedToday,activeJobId:active?.id??null,nextAt,summary,tracks:ctx.tracks.map(({code,name,phase,status,reason,lastJobId})=>({code,name,phase,status,reason,lastJobId})),blockers,recentJobs:[...ctx.jobs].sort((a,b)=>created(b)-created(a)).slice(0,12).map(job=>job.id),lastError:ctx.settings.lastError};",
)

replace_once_or_present(
    'runtime/public/autopilot-view.mjs',
    '<div><small>오늘 자동 AI</small><strong>${count(info?.aiUsedToday)} <em>/ ${count(info?.dailyAiLimit)}회</em></strong></div>',
    "<div><small>${info?.backgroundModelCalls===false?'백그라운드 AI':'오늘 자동 AI'}</small><strong>${info?.backgroundModelCalls===false?'꺼짐':count(info?.aiUsedToday)+' / '+count(info?.dailyAiLimit)+'회'}</strong></div>",
)
replace_once_or_present(
    'runtime/public/autopilot-view.mjs',
    '<p><strong>자동 AI 사용</strong><br>${count(info?.aiUsedToday)} / ${count(info?.dailyAiLimit)}회</p>',
    "<p><strong>자동 AI 사용</strong><br>${info?.backgroundModelCalls===false?'사용 안 함 · 명시적 호출만':count(info?.aiUsedToday)+' / '+count(info?.dailyAiLimit)+'회'}</p>",
)
replace_once_or_present(
    'runtime/public/autopilot-view.mjs',
    '<p class="studio-note">자동 AI 기본 한도는 하루 4회이며 전체 하루 ${count(info?.globalLimit)}회 한도 안에서 함께 사용합니다. 연구와 세계 현황은 6시간 간격으로 다음 작업을 확인합니다.</p>',
    '<p class="studio-note">${info?.backgroundModelCalls===false?\'독립 운영 모드입니다. 평상시 목표 선택·자료 관측·검증된 기능 실행·결과 저장·복구에는 모델을 호출하지 않습니다. AI는 연호님이 질문·음성·연구·코딩을 명시적으로 실행할 때만 사용합니다.\':\'자동 AI 기본 한도는 하루 4회이며 전체 하루 \'+count(info?.globalLimit)+\'회 한도 안에서 함께 사용합니다. 연구와 세계 현황은 6시간 간격으로 다음 작업을 확인합니다.\'}</p>',
)

replacement_test = r'''test('a real core restart without model credentials finishes a persisted settled research draft without another model call',{timeout:12000},async t=>{
  const [{default:fs},{default:os},{default:path},{start},{openStore,digest}]=await Promise.all([import('node:fs'),import('node:os'),import('node:path'),import('../server.mjs'),import('../lib/store.mjs')]);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackhole-autopilot-local-finish-'));
  const store=openStore(root),at=new Date().toISOString(),track=RESEARCH_TRACKS[0];
  store.state.projects.push({id:track.projectId,name:track.name,repositoryUrl:'',summary:'Synthetic recovery fixture',nextAction:'Verify local completion',status:'active',version:1,createdAt:at,updatedAt:at});
  store.state.modules.documents=false;
  store.state.autopilot={...initialAutopilot(),enabled:true,enabledAt:at};
  const seeded=addJob(store.state,research(store.state),{at,status:'paused',withAnswer:false});
  seeded.pauseReason='shutdown';seeded.step=2;seeded.draft='합성 복구 검사 답안입니다. 새 모델 호출 없이 같은 바이트를 저장해야 합니다.';
  seeded.agentJournal.provider='openai';seeded.agentJournal.model='synthetic-recovery-model';
  store.save();
  const owner='synthetic-autopilot-recovery-owner';let core,modelCalls=0,evidenceReads=0;
  t.after(()=>{core?.shutdown();fs.rmSync(root,{recursive:true,force:true});});
  const coreOptions={host:'127.0.0.1',port:0,dataDir:root,token:owner,env:{},
    researchFetch:async()=>{evidenceReads++;throw new Error('local completion must not fetch evidence');},
    agentFetch:async()=>{modelCalls++;throw new Error('local completion must not call a model');},
  };
  core=await start(coreOptions);
  assert.equal(core.state().agent.configured,false);
  const waitFor=async predicate=>{const until=Date.now()+5000;while(Date.now()<until){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Expected local completion was not reached');};
  const completed=await waitFor(()=>core.state().jobs.find(job=>job.id===seeded.id&&job.status==='completed'));
  assert.equal(modelCalls,0);assert.equal(evidenceReads,0);
  assert.equal(core.state().jobs.filter(job=>job.autopilot?.kind==='research').length,1);
  const finalStore=openStore(root).state,answer=completed.artifacts.find(file=>file.name.startsWith('research-answer-'));
  assert.ok(answer);const metadata=finalStore.artifacts[answer.id],bytes=fs.readFileSync(path.join(root,'artifacts',metadata.filename));
  assert.equal(digest(bytes),metadata.sha256);assert.equal(bytes.toString('utf8'),seeded.draft);
});

'''
regex_replace_once_or_present(
    'runtime/test/autopilot.test.mjs',
    r"test\('a real core restart without model credentials saves the same settled research draft without another model call'.*?(?=test\('settlement alone cannot resume research)",
    replacement_test,
    "a real core restart without model credentials finishes a persisted settled research draft without another model call",
)

changelog = Path('CHANGELOG.md')
marker = '# 2026-09-13 — 독립 OS 코어와 명시적 AI 호출 경계'
current = changelog.read_text(encoding='utf-8')
if marker not in current:
    entry = marker + '\n\n- API 키가 설정돼 있어도 자동 연구와 자료 갱신 뒤 자동 모델 검토를 생성하지 않도록 백그라운드 호출 권한을 제거했다.\n- 질문·음성·연구·코딩을 사용자가 직접 실행한 경우의 모델 연결은 유지한다.\n- AI 0회 상태에서도 규칙 기반 판단, 공개 관측, 검증된 기능 실행, 결과 저장·복구가 계속되는 회귀 검사를 추가했다.\n- 이미 저장된 최종 연구 초안은 새 호출 없이 결과 파일 저장을 마칠 수 있지만, 새 모델 응답이 필요한 자동 작업은 재개하지 않는다.\n\n'
    changelog.write_text(entry + current, encoding='utf-8')
