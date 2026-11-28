---
"@cosyte/script-utils": patch
---

`runPhiScan` takes a format's field detectors as plug-ins through a new `detectors` setting, reads every allow-list tag the format libraries use, and no longer prints a detector's thrown message.

A plug-in is `{ name, places, detect }`. Its `detect` is given the file's path, text, bytes, and the parsed allow-list, and returns findings of the form `{ place, rule, line?, offset? }`, where `place` is one of the places the detector declared and `rule` is one of `name`, `birth-date`, `date`, `identifier`, `ssn`, `address`, `phone`, `email`, `provider-id` and `phi-field`. The report prints the place, the line or offset, the engine's own sentence for the rule, and the detector's name, so a finding cannot carry the value it found. A finding with any other key (such as `value`), an undeclared place, or a rule outside the set refuses the scan at the refuse code.

The allow-list now also reads `ADDR` and `ADDRESS` (`allow.addresses`), `CITY`, `ZIP`, `PHONE`, `EMAIL <address>` and `EMAIL <path> <address>`, and DICOM's `DATE:<value>` lines and bare person-name lines holding `^`. The email floor clears an address an `EMAIL` line declares, in every file or in the one file it names. `isFictionalPhone` is exported: it is true only for a number in the fictional block 555-0100 to 555-0199.

A detector that throws, whether a plug-in or `detect`, still refuses the scan at the refuse code. The refusal now names the detector and the file and leaves out the detector's own message, which could quote the record it was reading.

What a caller must change: an allow-list with a `PHONE` line outside 555-0100 to 555-0199, or an `EMAIL` line that is neither `EMAIL <address>` nor `EMAIL <path> <address>`, now refuses the scan, naming the line. Replace the number with one from the block, or correct the line.
