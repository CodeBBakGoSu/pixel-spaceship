# ASTER WING 위키

Hawk로 10분 출격해 같은 고도의 적을 격추하고, 구슬을 모아 무기를 조합하고, 8분에 등장하는 Ace를 잡는 **개발판**의 안내서다. 지금 공개된 게임은 다른 버전이다.

**도감:** [무기 10종](CATALOG.md#weapons) · [버프 10종](CATALOG.md#buffs) · [격납고 강화 8종](CATALOG.md#hangar) · [해금 퀘스트 10종](CATALOG.md#quests)

**그림 도감:** [웹 도감 미리보기 (Devin 인증 필요 · 제공 빌드 확인 전)](https://aster-wing--9xv0plcv.preview.devinapps.com/docs/wiki/ASTER-WING-%EB%AC%B4%EA%B8%B0-%EB%B2%84%ED%94%84-%EB%8F%84%EA%B0%90.html) · [HTML 원본 보기 (Git)](ASTER-WING-무기-버프-도감.html)

인증 없이 그림 도감을 보려면 Git 원본에서 **Download raw file**로 내려받아 브라우저에서 연다. 설치나 다운로드 없이 읽으려면 위의 항목별 도감을 이용한다.

**기록:** [시도와 결정 이력](HISTORY.md) · [두 봇의 작업 로그](../WORKLOG.md)

<a id="versions"></a>

## 어느 버전을 보고 있나?

| 구분 | 확인된 기준 | 플레이어가 만나는 것 |
|---|---|---|
| **공개판** | [`main` · 801ff22](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/801ff22) · [Pages 배포 성공 기록](https://github.com/CodeBBakGoSu/pixel-spaceship/actions/runs/44273548548/job/134696012617) | [ASTER // Courier Run 플레이](https://codebbakgosu.github.io/pixel-spaceship/). 환초의 파일런, 협곡 문, 궤도 Warden을 거치는 아케이드 루프다. 아래 Survivors 도감은 이 판의 설명이 아니다. |
| **통합 후보** | [`dev1.0` · 6c66fc0](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/6c66fc07d1560495a96aa3b9fcab395d45ab88db) · 기반 [`renderer-proto` · 2d543dd](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/2d543dd50da389573f00ba4c85f2c3080b6fa9c1) · [플레이 미리보기](https://aster-wing--61hvcert.preview.devinapps.com/?seed=1&view=chase&lang=ko) | ASTER WING Survivors의 현 통합 후보. 무기·버프·진화, 영구 격납고 구매·해금 퀘스트가 연결돼 있다. 통합 담당은 서버 갱신, 5개 제공 모듈과 SHA 일치, 로컬 브라우저에서 첫 화면→출격 확인을 보고했다. 로그인 뒤 외부 주소에서의 플레이와 실기기 FPS는 미검증이며, P1 시각 수용 기준 전체도 남아 있다. |
| **실험** | [열린 PR](https://github.com/CodeBBakGoSu/pixel-spaceship/pulls?q=is%3Apr+is%3Aopen) · [검토 중·종료된 시도](HISTORY.md#experiments) | 실험 브랜치의 조작법·수치·녹화는 해당 후보의 증거다. PR을 열거나 닫은 것만으로 통합·배포가 되지 않는다. |

버전은 임의로 붙인 번호가 아니라 **브랜치 + 확인한 커밋**으로 기록한다. 개발 후보 SHA는 2026-11-24 조회 기준이며 최종 플레이 검수·공개 배포와 같지 않다. 기존 공개판은 `main`/Pages 기준으로만 안내한다.

## 무엇을 어디에 기록하나?

| 질문 | 먼저 볼 곳 |
|---|---|
| 지금 게임에서 얻거나 살 수 있는 것은? | [현행 도감](CATALOG.md). 수치가 다르면 해당 개발판의 [장비](../../src/data/items.ts)·[파일럿 데이터](../../src/data/meta.ts)가 기준이다. |
| 다음에 무엇을 만들고 어떻게 검수하나? | [구현 순서·담당별 인수 기준](../SURVIVORS_PLAN.md#pillars) → [무기 역할](../WEAPONS_BUFFS_PLAN.md#weapon-roles) · [잭팟 연출](../WEAPONS_BUFFS_PLAN.md#jackpot) · [패배 후 첫 승리](../WEAPONS_BUFFS_PLAN.md#first-clear) |
| 이전 아케이드 루프의 워프 비컨 상점 제안은? | [상점 설계안](../SHOP_PLAN.md). 기획 문서이며 `dev1.0`의 구현 기능이나 검증된 경제 수치가 아니다. |
| 왜 이 안을 썼고 다른 안은 왜 보류했나? | [결정과 대안](HISTORY.md) → [시드별 실험의 조건·결과](../BALANCE_NOTES.md) |
| 어떤 설계가 대체됐나? | [초기 종스크롤안](../SHMUP_PLAN.md) · [3뷰 아케이드 원안](../GAME_PLAN.md) · [레퍼런스 영상 분석](../../ref/VIDEO_ANALYSIS.md)은 과거 기록이다. |
| 특정 개발 단계에서 무엇을 바꿨나? | Stage 7의 [지형·저공 비행](../lanes/S7d.md) · [적·Ace](../lanes/S7e.md) · [그래픽 품질](../lanes/S7f.md)은 당시 작업 기록이다. |
| 기술 문제나 음원 사용 조건은? | [WebGL 오류 분석](../WEBGL_CONTEXT_LOSS.md) · [음원 출처·사용 조건](../AUDIO_CREDITS.md) · [음원 측정](../AUDIO_QA.md). |

## 그록봇·데븐 봇 공통 인계

1. 시작할 때 원격 브랜치를 갱신한 뒤 [작업 로그](../WORKLOG.md#log)에서 다른 봇의 작업 범위를 읽는다. 위 버전 표에서 자신의 기준판을 확인한다.
2. 실험이 끝나면 로그에 상세 검증을 남기고, [이력](HISTORY.md)에 **날짜 · 시도 · 상태 · 판단 근거 · 커밋/PR · 다음 확인**을 한 줄 기록한다. 채택하지 않은 시도도 지우지 않는다.
3. 실제 병합 때만 개발판 표와 영향을 받은 도감을 갱신하고, 공개판 표는 별도의 Pages 배포 성공을 확인한 뒤에만 바꾼다. 다음 봇에게는 수정할 위키 절과 로그 근거를 함께 넘긴다.
