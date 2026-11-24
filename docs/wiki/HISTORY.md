# 시도와 결정 이력

[위키 홈](README.md) · [전체 작업 로그](../WORKLOG.md#log) · [측정 원본](../BALANCE_NOTES.md)

**읽는 법:** ‘구현’은 개발 브랜치 병합, ‘기획 채택’은 만들기로 한 방향, ‘실험’은 별도 브랜치 결과다. 이 셋 모두 공개 배포와 다르다.

### 2026-11-24 · 10분 출격 개편 — 승인된 기획, 게임 미반영

홍기현님이 [최종안](SORTIE_10MIN.md)을 그대로 인계하도록 승인했다. 고도 단계 추가 대신 비행 가능한 공간 자체를 넓히고, 정해진 층 없이 실제 3D 접촉으로 판정한다. 휴지기 자동 자석 대신 엘리트·중간보스가 확률로 떨어뜨린 자석을 직접 줍는다. [검수 기준](SORTIE_10MIN.md#acceptance)은 측정 결과가 아니다.

## 게임이 어떻게 바뀌었나

| 시기 (KST) | 시도 → 결정 | 이유·근거 |
|---|---|---|
| 11/18–20 | [Courier Run 공개](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/801ff22) / [Survivors 개발 시작](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/ee94755) | 기존 3뷰 아케이드 루프를 공개판에 유지했다. 개발판은 한 출격 안에서 무기 조합과 성장을 느끼는 3D 복셀 생존 슈팅으로 분기했다. |
| 11/21–22 | 비행·고도 읽기, Red Kite, 스트리밍 지형 → [Forge 카메라·지형 통합](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/8265c4e) | 상승·하강과 기울기가 CHASE·콕핏에서 보이도록 카메라·그림자·지형 재질을 조정했다. [당시 비행기게임봇 기록](../WORKLOG.md#log) |
| 11/23 | [Stage C 고도 모델](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/1) 채택. Seeker 수직 속도 34→51 m/s는 보류 | 3개 밴드와 저공 비행을 분리했다. Seeker 속도만 바꿔도 기존 시드 128의 승리가 패배로 뒤집혀 [후속 통합](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/211e757)에서는 34를 유지했다. |
| 11/23 | [무기 10종을 Lv7로 확장](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/3), [피해 숫자·연속 격추](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/e46b813) 구현 | 레벨이 올라갈 때 탄선·범위가 실제로 바뀌고, 다수 격추 보상이 무리의 크기에 묻히지 않도록 했다. |
| 11/23 | [Gnat 무리](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/8f41122) → [장갑·접촉 변종](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/d4e4911) → [포위·횡단 스웜과 회수 자석](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/0bc1f99) 통합 | 적 수를 줄여 난도를 맞추지 않는다. 무리를 피한 뒤 흩어진 구슬을 한 번에 회수하도록 전투와 휴지기를 나눴다. PC 200/폰 120은 Gnat 상한이지 FPS 실측이 아니다. |
| 11/23 | 밀도 후보 1–4 비교 → [4안은 XP 실험 기준으로 채택](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/421ae44) | 2안은 폰 초보 10시드 선별에서 탈락. 4안의 폰 초보 100시드 격추 중앙값은 2,462로 하한 2,500에 38 부족했다. **모든 밸런스 목표 통과가 아니다.** [후보별 표](../BALANCE_NOTES.md#candidate-4-direct-phone-100-seed-evaluation) |
| 11/23 | 무기 역할 배지·시연·정답 맞히기 폐기 → [무기 자체의 전투 차이로 결정](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/cfb3abf) | 플레이어가 직접 쓰며 알아차리게 한다. 같은 상황에서 Twin의 전방 격추, Pods의 측면 방어, Seeker의 Ace 실피해를 비교한다. |
| 11/23 | 새 무기 첫 카드 예약 폐기 → [일반 풀 해금으로 결정](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/2564e31) | 무기가 후보에 들어가는 것과 그 무기로 출격하는 것은 다르다. 격납고 CR은 런 안에서만 쓰는 워프 비컨 회수품과 합치지 않는다. |
| 11/23 | 강제 패배·사망 횟수 잠금 배제 → [강화 후 첫 승리와 Hawk 격납고 기획 채택](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/81a0e2a) | 어느 판에서든 Ace를 잡으면 승리한다. 강화 뒤 생존·격파율이 오르는지를 측정한다. 새 기체는 보류. 보통 파일럿 첫 승리 중앙값 3~6판은 **목표이지 실측이 아니다**. |

<a id="experiments"></a>

## 통합판과 구분할 실험 (11/23 22:13 KST)

| 시도 | 이 시점의 상태 | 무엇이 남았나 |
|---|---|---|
| [워프 비컨 상점 PR #2](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/2) | 열림 · 대상은 `main` · 설계 문서 | 런 안의 구매 시점과 화폐다. 격납고 영구 강화 구현 또는 공개판 상점으로 읽지 않는다. |
| [P0 측정 도구 #4](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/4) · [별도 기준 측정 #5](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/5) | 닫힘·미병합 | 기준 장면에서 전방 30기 상한 때문에 Twin과 Seeker가 동률이었다. 후속 [Seeker 단일 표적 후보](https://github.com/CodeBBakGoSu/pixel-spaceship/blob/b64bc2f/docs/WORKLOG.md)는 전방 분업을 개선했지만 20m 측면 침입이 9→26으로 늘어 밸런스 검토가 남았다. |
| [공통 XP 곡선 #6](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/6) | 닫힘·미병합 | 첫 레벨업은 후보 600회 모두 10초 이내. 엄격한 4+4 완성 중앙값이 목표 7:30–8:00보다 늦고 폰 초보 격추도 하한 미달이었다. 현재판 XP로 표기하지 않는다. |
| [Ace 상호 락온·기동 회피 #7](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/7) | 열림 · 개발판 대상 | 발사 직전 기동으로 해당 일제사격만 끊는 후보. [브라우저 검증 범위](#ace-dodge) |
| [자동 플레어·폭탄, C 배럴롤 #8](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/8) | 열림 · 개발판 대상 | 장착했을 때만 자동 투하하는 후보. [조작·자동 투하 검증](#auto-countermeasures). 통합 전에는 기존 조작과 폭장 랙 해금 조건이 유효하다. |
| [P1 타격음·상자 릴·탄 잔상 #9](https://github.com/CodeBBakGoSu/pixel-spaceship/pull/9) | 열림 · [검증본 fb6412a](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/fb6412a) | [플레이 녹화](https://app.devin.ai/sessions/64ee5b09bb3f456bb9bf04ba1b3767f1?testRecording=b479b0cb-3404-4584-b72d-27ec5b47ba12)는 후보 버전의 검증이다. 높은 타격음 레이어 청감은 미검수. |

<a id="ace-dodge"></a>

### Ace 락온·회피: PR 후보 검증 (11/23 22:56 KST)

Product Engineer가 [후보 `1a0a5b2`](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/1a0a5b2a3d5fd3e5bb4bccba352bbf1fc4378f63)의 [브라우저 조작](https://app.devin.ai/sessions/f995748a1f3c4f929eeb74e526d39a42?testRecording=20512d50-f09e-4658-ad03-f959c57278c0)으로 양방향 락온과 조종석 경고, 기총·미사일 발사, W/S+Space 회피와 Shift 조합의 두 입력 순서를 확인했다.

발사 1틱 전 입력으로 해당 일제사격이 취소되는 경계는 프레임 시간과 키 입력을 자동 제어해 확인했다. 자연 플레이 완주 결과는 아니다. 검증 당시 이 수정은 개발판에 병합되지 않았고 공개 배포도 하지 않았다.

<a id="auto-countermeasures"></a>

### 장착형 자동 폭장·C 배럴롤: PR 후보 검증 (11/23 23:10 KST)

Product Engineer의 [조작 영상](https://app.devin.ai/sessions/7f15ccc7bd4c4b0ea3c7555fd75b88a2?testRecording=9b4b7f3e-18ba-4e5e-b6c3-ee6367b6e79b)은 `264b23a`에서 약한 마우스 조향·중립 C롤, 기존 Shift+Space 및 W/S+Space 조합, 터치 에뮬레이션을 확인했다. [폭탄창 영상](https://app.devin.ai/sessions/7f15ccc7bd4c4b0ea3c7555fd75b88a2?testRecording=51a6487b-364c-40ac-b60b-7bd77dd91839)은 `e104198`에서 장착한 폭탄창이 수동 입력 없이 투하하는 장면이다.

준비된 전투 장면에서의 확인이며 실물 모바일과 일반 플레이를 통한 해금·클리어는 미검증이다. 인계 당시 PR #8(`cf53220`)은 충돌이 표시됐고 개발판 병합·공개 배포는 하지 않았다.

<a id="p1-96bd079"></a>

### P1 상자 연출: 밸런스 봇 검증 (11/23 22:21 KST 인계)

대상은 [`96bd079`](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/96bd079)이며, 근거는 [밸런스 봇의 검증 녹화](https://app.devin.ai/sessions/4877fabcbb3c41a1a271bf5723afd5d6?testRecording=a6a95869-3df8-4aca-b729-b3552c353cd2)다. 이 결과는 위의 `fb6412a`, 개발 통합판, 공개판의 검증 결과가 아니다.

| 항목 | 이 커밋에서 확인한 결과 |
|---|---|
| 보상·재개 | 상자 5종 모두 연출 켜기·끄기·건너뛰기에서 보상이 같았고, 전투 재개 120틱 뒤 상태도 일치했다. |
| 소리·문구 | 시드 18에서 첫 클릭으로 음원이 시작됐다. 한국어 ‘잭팟’ 표시는 실패했다. |
| 성능·가독성 | 소프트웨어 렌더링 PC 6.58 FPS, 모바일 에뮬레이션 16.55 FPS. 실제 기기 FPS와 전 구간 가독성은 확인하지 않았다. |

<a id="p1-font"></a>

**후속 글꼴 수정 후보 (11/23 22:22 KST):** [`61154f5`](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/61154f53af5a7214f75cb045d019a08c1b28969e)의 시드 18 한국어 화면에서 ‘잭팟 ×5’와 보상 5개(쌍발 기관포 Lv2~6)가 모두 보인다. 이 화면은 표기 수정의 근거이며 개발판 통합이나 실제 기기 성능의 근거가 아니다.

<a id="p1-trail"></a>

**탄 잔상 후보: 개발판 통합 보류 (11/23 22:44 KST).** Product Engineer가 [후보 `61154f5`](https://github.com/CodeBBakGoSu/pixel-spaceship/commit/61154f53af5a7214f75cb045d019a08c1b28969e)의 시드 18 이동 리플레이에서 [탄 잔상을 켠 화면과 끈 화면](https://app.devin.ai/sessions/64ee5b09bb3f456bb9bf04ba1b3767f1?testRecording=a05fc0da-575b-45a6-81f9-b9ec11de1679)을 비교했다.

| 확인한 것 | 결과 |
|---|---|
| 락온 경고·전투 상태 | 가상 PC·폰에서 락온 경고는 잔상 유무와 관계없이 1–51틱에 보였다. 각 기기 조건에서 180틱 뒤 전투 상태도 일치했다. |
| 적탄 가독성 | 폰 에뮬레이션의 29틱 왼쪽 적탄은 **잔상을 꺼도** 가려졌다. 발사 후 겹친 유도탄도 양쪽 모두에서 개별 추적이 어려웠다. 잔상이 가림의 원인이라는 근거는 없다. |
| 통합 판단 | 실물 PC·폰 성능은 미검증이라 후보의 통합·배포는 보류했다. 이 후속 락온 장면에서는 프레임 비용을 다시 측정하지 않았다. |

추가할 때는 당시 근거를 덮어쓰지 않는다. 예: `날짜 | 시도·커밋/PR | 채택/보류/폐기 및 이유 | 재검토 조건 또는 검증 링크`. 병합·배포처럼 상태가 바뀌면 새 근거와 날짜를 붙인다.
