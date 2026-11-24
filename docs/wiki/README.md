# ASTER WING 위키

Hawk로 10분 출격해 같은 고도의 적을 격추하고, 구슬을 모아 무기를 조합하고, 8분에 등장하는 Ace를 잡는 **개발판**의 안내서다. 지금 공개된 게임은 다른 버전이다.

**승인된 기획, 게임 미반영:** [10분 출격 개편안](SORTIE_10MIN.md) · [분별 편성](SORTIE_10MIN.md#minutes) · [검수 기준](SORTIE_10MIN.md#acceptance). 아래 도감은 이 승인안이 아니라 현재 개발판을 설명한다.

**도감:** [무기 10종](CATALOG.md#weapons) · [버프 10종](CATALOG.md#buffs) · [격납고 강화 8종](CATALOG.md#hangar) · [해금 퀘스트 10종](CATALOG.md#quests)

**그림 도감:** [웹 도감 열기 (Devin 인증 필요)](https://aster-wing--9xv0plcv.preview.devinapps.com/docs/wiki/ASTER-WING-%EB%AC%B4%EA%B8%B0-%EB%B2%84%ED%94%84-%EB%8F%84%EA%B0%90.html) · [HTML 원본 보기 (Git)](ASTER-WING-무기-버프-도감.html)

인증 없이 그림 도감을 보려면 Git 원본에서 **Download raw file**로 내려받아 브라우저에서 연다. 설치나 다운로드 없이 읽으려면 위의 항목별 도감을 이용한다.

**기록:** [시도와 결정 이력](HISTORY.md) · [두 봇의 작업 로그](../WORKLOG.md)

<a id="versions"></a>

## 어느 버전을 보고 있나?

| 구분 | 확인된 기준 | 플레이어가 만나는 것 |
|---|---|---|
| **공개판** | [`main` · 801ff22](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/801ff22) · [Pages 배포 성공 기록](https://github.com/CodeBBakGoSu/pixel-spaceship/actions/runs/44273548548/job/134696012617) | [ASTER // Courier Run 플레이](https://codebbakgosu.github.io/pixel-spaceship/). 환초의 파일런, 협곡 문, 궤도 Warden을 거치는 아케이드 루프다. 아래 Survivors 도감은 이 판의 설명이 아니다. |
| **개발 통합판** | [`renderer-proto` 최신 트리](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/renderer-proto) · [이 문서의 게임·기획 기준 81a0e2a](https://github.com/CodeBBakGoSu/pixel-spaceship/tree/81a0e2a) | ASTER WING Survivors. 무기·버프·진화와 크레딧 구매는 구현됐다. Hawk 미리보기와 첫 승리 곡선은 기획이며 게임에 적용된 상태가 아니다. |
| **실험** | [열린 PR](https://github.com/CodeBBakGoSu/pixel-spaceship/pulls?q=is%3Apr+is%3Aopen) · [검토 중·종료된 시도](HISTORY.md#experiments) | 실험 브랜치의 조작법·수치·녹화는 해당 후보의 증거다. PR을 열거나 닫은 것만으로 통합·배포가 되지 않는다. |

버전은 임의로 붙인 번호가 아니라 **브랜치 + 확인한 커밋**으로 기록한다. 위 기준과 PR 상태는 2026-11-23 22:13 KST 조회 시점이며, 새 병합이나 배포가 있으면 각 행을 따로 갱신한다.

## 무엇을 어디에 기록하나?

| 질문 | 먼저 볼 곳 |
|---|---|
| 지금 게임에서 얻거나 살 수 있는 것은? | [현행 도감](CATALOG.md). 수치가 다르면 해당 개발판의 [장비](../../src/data/items.ts)·[파일럿 데이터](../../src/data/meta.ts)가 기준이다. |
| 다음에 무엇을 만들고 어떻게 검수하나? | [구현 순서·담당별 인수 기준](../SURVIVORS_PLAN.md#pillars) → [무기 역할](../WEAPONS_BUFFS_PLAN.md#weapon-roles) · [잭팟 연출](../WEAPONS_BUFFS_PLAN.md#jackpot) · [패배 후 첫 승리](../WEAPONS_BUFFS_PLAN.md#first-clear) |
| 왜 이 안을 썼고 다른 안은 왜 보류했나? | [결정과 대안](HISTORY.md) → [시드별 실험의 조건·결과](../BALANCE_NOTES.md) |
| 어떤 설계가 대체됐나? | [초기 종스크롤안](../SHMUP_PLAN.md) · [3뷰 아케이드 원안](../GAME_PLAN.md) · [레퍼런스 영상 분석](../../ref/VIDEO_ANALYSIS.md)은 과거 기록이다. |
| 특정 개발 단계에서 무엇을 바꿨나? | Stage 7의 [지형·저공 비행](../lanes/S7d.md) · [적·Ace](../lanes/S7e.md) · [그래픽 품질](../lanes/S7f.md)은 당시 작업 기록이다. |
| 기술 문제나 음원 사용 조건은? | [WebGL 오류 분석](../WEBGL_CONTEXT_LOSS.md) · [음원 출처·사용 조건](../AUDIO_CREDITS.md) · [음원 측정](../AUDIO_QA.md). |

## 그록봇·데븐 봇 공통 인계

1. 시작할 때 원격 브랜치를 갱신한 뒤 [작업 로그](../WORKLOG.md#log)에서 다른 봇의 작업 범위를 읽는다. 위 버전 표에서 자신의 기준판을 확인한다.
2. 실험이 끝나면 로그에 상세 검증을 남기고, [이력](HISTORY.md)에 **날짜 · 시도 · 상태 · 판단 근거 · 커밋/PR · 다음 확인**을 한 줄 기록한다. 채택하지 않은 시도도 지우지 않는다.
3. 실제 병합 때만 개발판 표와 영향을 받은 도감을 갱신하고, 공개판 표는 별도의 Pages 배포 성공을 확인한 뒤에만 바꾼다. 다음 봇에게는 수정할 위키 절과 로그 근거를 함께 넘긴다.
