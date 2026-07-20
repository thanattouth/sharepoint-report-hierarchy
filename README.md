# SharePoint Sensitivity Label Report

ระบบรายงานไฟล์ที่ติด Microsoft Purview Sensitivity Label ภายใต้ SharePoint
hierarchy scope ของผู้ใช้ ปัจจุบัน P0–P3 ทำงานด้วย deterministic cached fixtures
P4 เชื่อม Graph แบบ bounded ที่ DGCS แล้ว P5/P6 แยก scheduled scanner กับ
cache-only Report API เป็นคนละ Azure Functions/managed identities และ P7 ย้าย business
hierarchy, User/Group assignments และ canonical Site placements ไปเป็น persistent Azure Tables

Business hierarchy เป็น forest ของหลาย EVP roots โดยแต่ละสายใช้โครงสร้าง
`EVP -> Department -> Group -> Project` ผู้ใช้ทุกระดับรวมถึง EVP เห็นเฉพาะ Sites
ที่มี active mapping อยู่ใน node/descendants ของตน ไม่ได้เห็นทั้ง tenant จาก role เพียงอย่างเดียว

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
```

หน้า Report ใช้ cached store contracts เท่านั้นและไม่เรียก Microsoft Graph ตอนโหลดหน้า
P4 scanner boundary, environment contract และขั้นตอน approval อยู่ใน
`docs/p4-graph-pilot.md` ห้าม commit populated `.env` หรือ scanner credential

P5 Timer/Queue deployment, cross-tenant federation, bounded Run now proof และ recovery
อยู่ใน `docs/p5-scheduled-scanner-runbook.md` Timer ถูก deploy แบบ disabled จนกว่า
source-tenant admin consent และ manual proof จะผ่าน

P7 schema, migration, rollback และ admin-write boundary อยู่ใน
`docs/p7-business-scope-configuration.md` Report API มีสิทธิ์อ่านเท่านั้น ส่วน
Configuration Admin API เป็น service แยกและยังไม่เปิด browser write จนกว่าจะ provision
identity/RBAC และ authenticated administrator flow
