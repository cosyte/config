---
"@cosyte/script-utils": patch
---

`internal-refs`: the phase or wave rule now reads the word after `phase` to decide whether it names a phase. A number, a number word, a letter, a roman numeral or a capitalized word still names one, so `phase 2`, `phase one`, `Phase W`, `Phase Atlas`, `in a later phase` and `wave 3` are still hits. An ordinary lowercase word now makes `phase` a noun and passes, so clinical study phase wording in vendored standard data no longer fails the gate: HL7 table 0003's `CRM - Correct/update phase information` and `MFN/MFK - Clinical study without phases but with schedules master file`, and imaging terms such as `phase encoding`. What no longer refuses: a lowercase `phase` before an ordinary lowercase word, such as `phase foundations`; write a roadmap name with a capital or a number and it is still caught. Callers change nothing.
