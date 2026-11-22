# Zyn Agent v1.8.2

- Keep instructions for recovering incomplete responses out of saved conversation history.
- Attempt recovery once when the model ends with commentary alone, then report the missing action if it repeats.
- Restore framed subagent events and completion marks. Show tool errors in the terminal.
- Existing sessions may still contain recovery messages saved by earlier versions.

The GitHub release does not publish to npm. The npm workflow runs separately.
