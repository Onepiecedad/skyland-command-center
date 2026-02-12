#!/bin/bash
# Split App.css into domain-specific CSS files
# Each sed command extracts a line range from App.css to a target file

CSS="App.css"
OUT="styles"

# 1. base.css — Design tokens, animations, reset, body, parallax (L1-213)
sed -n '1,213p' "$CSS" > "$OUT/base.css"

# 2. layout.css — Dashboard shell, header, nav, grid, panels, scrollbar + Dashboard V2 shell/header/main (L214-412, L1527-1544, L3746-3842)
{
  echo "/* ── Layout: Dashboard Shell, Header, Nav, Grid, Panels, Scrollbar ── */"
  echo ""
  sed -n '214,412p' "$CSS"
  echo ""
  sed -n '1527,1544p' "$CSS"
  echo ""
  echo "/* ── Dashboard V2 Shell, Header, Main ── */"
  echo ""
  sed -n '3746,3842p' "$CSS"
} > "$OUT/layout.css"

# 3. customers.css — Customer list, activity log, filter bar + Customer View V2 (L413-622, L5168-5837)
{
  echo "/* ── Customers: List, Cards, Activity, Detail Panel ── */"
  echo ""
  sed -n '413,622p' "$CSS"
  echo ""
  echo "/* ── Customer View V2 — Card Grid + Detail Panel ── */"
  echo ""
  sed -n '5168,5837p' "$CSS"
} > "$OUT/customers.css"

# 4. alex.css — Chat panel, markdown, input, toolbar, streaming, AlexView layout, profile, sidebar, skills in alex, role inspector, thread sidebar, memory panel, attachments (L791-1526, L3454-3622, L4187-5167, L8608-9115)
{
  echo "/* ── Alex: Chat, Markdown, Input, Toolbar ── */"
  echo ""
  sed -n '791,1526p' "$CSS"
  echo ""
  echo "/* ── Streaming Chat & Alex Gateway ── */"
  echo ""
  sed -n '3454,3622p' "$CSS"
  echo ""
  echo "/* ── Alex View Layout, Profile, Sidebar, Skills Panel, Skill Detail, Role Inspector ── */"
  echo ""
  sed -n '4187,5167p' "$CSS"
  echo ""
  echo "/* ── Thread Sidebar, Memory Panel, Chat Attachments ── */"
  echo ""
  sed -n '8608,9115p' "$CSS"
} > "$OUT/alex.css"

# 5. system.css — Task list, badges, momentum, 3D realm, task detail, dispatch, task progress, run log, system monitor, open task buttons, responsive + System Dashboard (L623-790, L1545-2301, L5838-6620)
{
  echo "/* ── System: Tasks, 3D Realm, Task Detail, Progress, RunLog, Monitor ── */"
  echo ""
  sed -n '623,790p' "$CSS"
  echo ""
  sed -n '1545,2301p' "$CSS"
  echo ""
  echo "/* ── System Dashboard — AI System Overview ── */"
  echo ""
  sed -n '5838,6620p' "$CSS"
} > "$OUT/system.css"

# 6. skills.css — Old skills (L2302-2718 = Agent Hub old, actually this is wrong)
# Let me re-check: L2302 = AGENT HUB, L2719 = Skill Card old, L2820 = Skill Detail Modal old
# L6622 = SKILLS VIEW (Ticket 11.3), L7070 = Git Panel
# Skills = L2719-2984 (old) + L4588-4922 (alex skills panel) + L6622-7418 (SkillsView + Git Panel + responsive)
{
  echo "/* ── Skills: Skill Cards, Detail Modal (Legacy) ── */"
  echo ""
  sed -n '2719,2984p' "$CSS"
  echo ""
  echo "/* ── Skills View — Skill Registry ── */"
  echo ""
  sed -n '6622,7418p' "$CSS"
} > "$OUT/skills.css"

# 7. fleet.css — Agent Hub (L2302-2718), Alex Hero Status (L3623-3745), Agent Monitor component (L4091-4186), Fleet Monitor (L7420-8607)
{
  echo "/* ── Fleet: Agent Hub ── */"
  echo ""
  sed -n '2302,2718p' "$CSS"
  echo ""
  echo "/* ── Alex Hero Status Card ── */"
  echo ""
  sed -n '3623,3745p' "$CSS"
  echo ""
  echo "/* ── Agent Monitor Component ── */"
  echo ""
  sed -n '4091,4186p' "$CSS"
  echo ""
  echo "/* ── Fleet Monitor — Agent Cards, Detail, Reasoning Stream ── */"
  echo ""
  sed -n '7420,8607p' "$CSS"
} > "$OUT/fleet.css"

# 8. costs.css — Cost Center + responsive (L2985-3453)
{
  echo "/* ── Costs: Cost Center Dashboard ── */"
  echo ""
  sed -n '2985,3453p' "$CSS"
} > "$OUT/costs.css"

# 9. components.css — SegmentedControl, StatusBar, gateway pills, status dots, alex state, node count (L3843-4090, L5769-5837 responsive v2)
{
  echo "/* ── Components: SegmentedControl, StatusBar, Gateway ── */"
  echo ""
  sed -n '3843,4090p' "$CSS"
  echo ""
  echo "/* ── Responsive — Dashboard V2 ── */"
  echo ""
  sed -n '5769,5837p' "$CSS"
} > "$OUT/components.css"

echo "Done! Files created in $OUT/"
ls -la "$OUT/"
