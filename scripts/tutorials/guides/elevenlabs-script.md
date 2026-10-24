# Writing an ElevenLabs voice script

How a tutorial voice script for ElevenLabs is written, with Episode 1 of "Dominik Flamer" as the
example. Use the tutorial voice `nQ95rSg3xpIIuIQxL1w6` (see `../README.md`, "The voice").

- Audio tags in square brackets set the delivery of the words that follow: emotion (`[proudly]`,
  `[deadpan]`), a role (`[like a game show host]`), tempo (`[quickly]`, `[slows down]`) or a sound
  (`[gasps]`, `[clears throat]`, `[sighs dramatically]`). Several directions can share one tag:
  `[whisper, slowly, ominous]`.
- Pauses are tags too (`[pause]`, `[short pause]`, `[long pause]`, `[dramatic pause]`), and so are
  ellipses inside a line ("very... exciting").
- Hard switches carry the comedy: a dramatic line, then `[casual, as if nothing happened]`.
- Every episode opens with "Hey, what's up, Dominik Flamer here, and today …", never with "BOOM".
- The recipe's `say` texts hold exactly these words in this order; the tags may stay in, because
  the pipeline ignores everything in square brackets when it matches words to times.

## Example: Episode 1

```text
[theatrical, booming] Hey, what's up! [proudly] Dominik Flamer here for MasterSelects dot com, [over-the-top excited] and welcome back to another... [dramatic pause] very... exciting tutorial!

[pause]

[proudly, enegetic] Today we're starting from zero. [soothing] Just the basics. Nice... and easy.

[pause]

[deadpan] Which means if you already know everything... [short pause] [mischievously] you can skip ahead and just nod along. [theatrical, wounded] I won't know. [dramatic pause] [whisper, , slowly, ominous] Or, will I?

[long pause]

[clears throat] [snaps back to upbeat] Okay! So, first things first, let's open up a new project. [like a game show host] Right here we've got our timeline! [quickly] Our viewer! [slows down, mysterious, almost whispering] And over here... [gasps] [theatrical, awestruck] the node editor. [reverent] This is where all the magic happens.

[pause]

[deadpan] And by magic, I mean tiny boxes... [short pause] connected with tiny lines.

[short pause]

[sighs dramatically, defeated] It's basically spaghetti. [pause] [suddenly triumphant] But organized spaghetti! [theatrical, heroic speech, slow] And that... is what separates us... from the animals.

[dramatic pause]

[casual, as if nothing happened] Alright, let's drag in our first clip...
```

The tone of these scripts follows `kramer-style.md`.
