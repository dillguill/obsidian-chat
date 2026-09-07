---
title: Prompt Notebook | Civitai
source: https://civitai.com/articles/3160/prompt-notebook
cover: https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/6d7eebfb-6df9-44b2-bb98-d023fc4e76b3/width=1200/6d7eebfb-6df9-44b2-bb98-d023fc4e76b3.jpeg
author:
  - "[[taches]]"
published: 2024-04-06
description: Introduction Hi there. Here are some notes about how I structure my prompts. This guide is the result of personal experiences, so nothing is consid...
type: doc
tags: [guides, prompts, T2I]
---
![Prompt Notebook](https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/6d7eebfb-6df9-44b2-bb98-d023fc4e76b3/width=1320/final_00001_.jpeg)

## Introduction

Hi there. Here are some notes about how I structure my prompts. This guide is the result of personal experiences, so nothing is considered as ground truth, it's just what is working well for me!

I've been largely inspired by [TianChimp](https://civitai.com/user/TianChimp) 's one written in [Hardcore - Hentai](https://civitai.com/models/136054?modelVersionId=232266) checkpoint. Check my [favorite models](https://civitai.com/collections/3657301), they usually work pretty well with my way of prompting.

If you want to have a look on my environment, check my [ComfyUI Workflow](https://civitai.com/articles/5366/) article. Also, my [Scene Composer](https://civitai.com/articles/5760/comfyui-workflow-scene-composer) workflow is a good example on the prompting structure I propose.

I will update this article from time to time. Don't hesitate to take it, tweak, and share your thoughts!

## Philosophy

I try to follow the philosophic guidelines when I do my prompts. I recommend to read Danbooru's [Howto](https://danbooru.donmai.us/wiki_pages/howto:tag), which are good base lines.

- **Tag what you see, not what you know**. Don't use tags of stuff that is not visible in the final image. If the character has jeans but the framing is at upper body, don't mention it.
- **Be explicit.** Avoid abstract concepts and prefer visual ones. For example, "writing" is better than "doing homeworks".
- **Minimal Tagging Criteria**. Too much tags cause noise and lead to less precise results. Keep things to the strict minimum, put down only what you absolutely want to see. For example, why put an "nsfw" tag if your scene is already explicit?
- **Use common words.** You don't have to restricts tags to the Danbooru's list, but I recommend using simple, commons and straight-forwards keywords. You would typically prefer "excited" than "ecstatic". Keep in mind this does *not* mean using less *specific* words ("shirt") over more specific ones ("blouse"), that would still be recognized. *(thanks to* [*NanashiAnon*](https://civitai.com/user/NanashiAnon) *for the precision)*

## Structure

I principally structure my prompts into 4 categories: Composition, Action, Subject, Environment. It can easily be remembered via its acronym: **CASE.**

I personally like to separate those concepts with break lines, it helps me to quickly make adjustments. I recommend having a look at [**Danbooru tag groups**](https://danbooru.donmai.us/wiki_pages/tag_groups) to find what you need.

Keep in mind that it's a guideline. It's ok to mix the order of concepts and tags, especially inside a category.

**1\.** [**Composition**](https://danbooru.donmai.us/wiki_pages/tag_group%3Aimage_composition)

- Quality
- Style (photorealistic, color palette, …)
- Camera (angle, framings, point of view, …)
- Protagonists (1boy, 1girl, animal, object, landscape, …)

**2\. Action**

- [Sex acts](https://danbooru.donmai.us/wiki_pages/tag_group%3Asex_acts)
- [Sexual positions](https://danbooru.donmai.us/wiki_pages/tag_group%3Asexual_positions) / [Posture](https://danbooru.donmai.us/wiki_pages/tag_group%3Aposture)

**3\. Subject**

- [Body](https://danbooru.donmai.us/wiki_pages/tag_group%3Abody_parts) (body type, breast size, skin color, breasts, …)
- Face related (eyes color, hairstyle, …)
- Attitude (happy, surprised, serious, determined, …)
- Expressions (open eyes, open mouth, frowning, …)
- [Clothes](https://danbooru.donmai.us/wiki_pages/tag_group%3Aattire)

**4\. Environment**

1. Indoors / Outdoors
2. Light / Time of day (sunny, dawn, dusk, night)
3. Weather (wind, rain, snow, …)
4. Objects (furnitures, vehicules, …)

*Keep in mind that for certain models, some tags will lead to unexpected results. Typically FLUX, tags like* `boy` */* `girl` *will output children: you should use* `man` */* `woman`*.*

## About prompt's length

The prompt is split by words (or chunks of words) to transform them into numerical representation called tokens. Depending on which models are used and how tokens are normalized, certain parts of your prompt will have more or less attention. My rule of thumb: keep your prompt short and avoid useless repetitions. You'll have more control over it.

Here's some resources if you want to read more on that matter:

[Tokens with SDXL and SD15 models](https://www.alenknight.com/?p=2298#:~:text=SDXL%3A%20Effective%20token%20range%20for%20large,changes%20is%20between%2027%20to%2033%20tokens) – Alen Knight

[Token normalization & Weight interpretation](https://github.com/BlenderNeko/ComfyUI_ADV_CLIP_emb) – BlenderNeko (Github)

## Example

Here is an example following the structure. I usually put some break lines to have a better look on the main areas of the prompt.

```
score_9, score_8_up, score_7_up, score_6_up, source_anime,
lineart, portrait, from above,

1girl, ginger, solo,
writing, holding pencil,
sitting, heads up,

sweat, freckles, small breasts,
ginger hair, long hair, straight hair,
blue eyes, glowing eyes, glasses, looking at viewer,
smile, smirk, grin, frown,
white tank top,

indoor, library,
sunset, sunny, daylight,
sidelighting, light particles,
desk, chair,
```

![](https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/3d8b1b37-5742-4c09-bac0-d0ce6331e0c2/width=525/3d8b1b37-5742-4c09-bac0-d0ce6331e0c2.jpeg) 

As you can see, the breaklines don't divide perfectly the 4 fields of the structure. Depending on what you want to generate, it can make more sense to visually separate smaller and longer parts. Here, the *subject*, *actions* and *posture* of the body are grouped together: splitting them would create a mess visually more than anything.

## Usecases

Here are some usecases and favorite keywords. I try to organise by logical group, from the most general to the more specific. I recommand to cherry-pick the one that make sense for you rather than copy-paste the all line.

You'll also find a reference to where I place it in the structure. I'll use an ID with the format \[xx.yy\], using the acronym of the category and its sub-category.

Keep in mind that some of them could also go higher or lower in the apparition order (e.g. *upside down* could be placed as \[compos.pov\] or \[body.posture\].

## Generic

Here is what I use in almost all my prompt to influence the overall quality of the image. I usually add additional negative keywords if something that I don't like appear, but not before. Again, I like to keep things short and simple.

Following list cover some classic cases, detailing both *positive* and *negative* prompts.

- **Quality (SD1.5/Illustrious/NoobAI)**  
	masterpiece, best quality, [absurdres](https://danbooru.donmai.us/wiki_pages/absurdres),  
	worst quality, low quality, [lowres](https://danbooru.donmai.us/wiki_pages/lowres), normal quality
- **Quality++**  
	amazing quality, very aesthetic, newest, volumetric lighting  
	bad anatomy, sketch, jpeg artifacts, signature, watermark, old, oldest
- **Quality (Pony)**  
	score\_9, score\_8\_up, score\_7\_up, score\_6\_up, score\_5\_up, score\_4\_up,  
	score\_6, score\_5, score\_4,
- **Details**  
	detailed, detailed body, detailed face
- **Negative+**  
	text, logo, watermark, digit, [multiple views,](https://danbooru.donmai.us/wiki_pages/multiple_views) [monochrome,](https://danbooru.donmai.us/wiki_pages/monochrome)  
	[bad proportions,](https://danbooru.donmai.us/wiki_pages/bad_proportions) [anatomical nonsense,](https://danbooru.donmai.us/wiki_pages/anatomical_nonsense) [bad hands,](https://danbooru.donmai.us/wiki_pages/bad_hands) [bad face](https://danbooru.donmai.us/wiki_pages/bad_face)

*Note: Negative+ is an additional list where I cherry-pick according to the situation. In my experience, negative keywords related to anatomic don't always improve the results, so I just keep them aside in case I need it.*

## Scenes

- **Dynamic style** \[compos.style\]: [motion lines](https://danbooru.donmai.us/wiki_pages/motion_lines), [emphasis lines](https://danbooru.donmai.us/wiki_pages/emphasis_lines), [speed lines,](https://safebooru.donmai.us/wiki_pages/speed_lines) [afterimage,](https://danbooru.donmai.us/wiki_pages/afterimage)[motion blur](https://danbooru.donmai.us/wiki_pages/motion_blur), [bouncing](https://danbooru.donmai.us/wiki_pages/bouncing) (+ [hair](https://danbooru.donmai.us/wiki_pages/bouncing_hair), [breasts](https://danbooru.donmai.us/wiki_pages/bouncing_breasts), [ass](https://danbooru.donmai.us/wiki_pages/bouncing_ass), etc), [ass ripple](https://danbooru.donmai.us/wiki_pages/ass_ripple), [sweatdrop,](https://danbooru.donmai.us/wiki_pages/sweatdrop)[trembling,](https://danbooru.donmai.us/wiki_pages/trembling) [shaking,](https://danbooru.donmai.us/wiki_pages/shaking) [twitching,](https://danbooru.donmai.us/wiki_pages/twitching)[(spoken)](https://danbooru.donmai.us/wiki_pages/spoken_sound_effect) [sound effects](https://danbooru.donmai.us/posts?tags=sound_effects), [sparkling sweat](https://danbooru.donmai.us/wiki_pages/sparkling_sweat)
- **Dynamic composition** \[compos.camera\]: [depth of field](https://danbooru.donmai.us/wiki_pages/depth_of_field), [foreshortening](https://danbooru.donmai.us/posts?tags=foreshortening), [perspective](https://danbooru.donmai.us/wiki_pages/perspective), [Vanishing point](https://danbooru.donmai.us/wiki_pages/vanishing_point),
- **Lightning** \[compos.light\]: [backlighting,](https://danbooru.donmai.us/wiki_pages/backlighting) dim light, rim light, [dusk,](https://danbooru.donmai.us/wiki_pages/dusk) [sunset,](https://danbooru.donmai.us/wiki_pages/sunset) [dawn,](https://danbooru.donmai.us/wiki_pages/dawn) [sunrise,](https://danbooru.donmai.us/wiki_pages/sunrise) [light particles,](https://danbooru.donmai.us/posts?tags=light_particles) [light rays,](https://danbooru.donmai.us/posts?tags=light_rays) [sunlight,](https://danbooru.donmai.us/wiki_pages/sunlight) [dappled sunlight,](https://danbooru.donmai.us/posts?tags=dappled_sunlight) [tree shade,](https://danbooru.donmai.us/wiki_pages/tree_shade) [crack of light](https://danbooru.donmai.us/posts?tags=crack_of_light)
- **Hot** \[body.posture\]: [sweat,](https://danbooru.donmai.us/wiki_pages/sweat) sweating,[very sweaty,](https://danbooru.donmai.us/wiki_pages/very_sweaty)[sweating profusely](https://danbooru.donmai.us/wiki_pages/sweating_profusely), [sparkling sweat](https://danbooru.donmai.us/posts?tags=sparkling_sweat),[wet](https://danbooru.donmai.us/wiki_pages/wet) (+ [clothes](https://danbooru.donmai.us/wiki_pages/wet_clothes),[hair](https://danbooru.donmai.us/wiki_pages/wet_hair), etc), [sweat clothes](https://danbooru.donmai.us/wiki_pages/sweaty_clothes), [hot](https://danbooru.donmai.us/wiki_pages/hot), [heat stroke](https://danbooru.donmai.us/wiki_pages/heat_stroke), [blush](https://danbooru.donmai.us/wiki_pages/blush), [full-face blush](https://danbooru.donmai.us/wiki_pages/full-face_blush), [body blush](https://danbooru.donmai.us/wiki_pages/body_blush), [breath](https://danbooru.donmai.us/wiki_pages/breath), [heavy breathing](https://danbooru.donmai.us/wiki_pages/heavy_breathing), [steaming body](https://danbooru.donmai.us/wiki_pages/steaming_body),
- **Bondage:**[bondage,](https://danbooru.donmai.us/posts?tags=bondage)[shibari,](https://danbooru.donmai.us/posts?tags=shibari)[leash,](https://danbooru.donmai.us/posts?tags=leash)[animal collar,](https://danbooru.donmai.us/wiki_pages/animal_collar)[cuffs,](https://danbooru.donmai.us/posts?tags=cuffs)[arms behind head](https://danbooru.donmai.us/posts?tags=arms_behind_head) / [back](https://danbooru.donmai.us/posts?tags=arms_behind_back),[rope,](https://danbooru.donmai.us/posts?tags=rope)[gag](https://danbooru.donmai.us/posts?tags=gag)
- **Gangbang** \[subjects\]: [multiple boys](https://danbooru.donmai.us/wiki_pages/multiple_boys) / [girls](https://danbooru.donmai.us/wiki_pages/multiple_girls), [group sex,](https://danbooru.donmai.us/wiki_pages/group_sex)[gangbang,](https://danbooru.donmai.us/posts?tags=gangbang)[orgy,](https://danbooru.donmai.us/wiki_pages/orgy) [dogpile,](https://danbooru.donmai.us/posts?tags=dogpile)[love train,](https://danbooru.donmai.us/posts?tags=love_train) [threesome,](https://danbooru.donmai.us/wiki_pages/threesome)  
	*Note: precise exact number with* ***x*** *boys/* ***x*** *girls.*
- **Tentacles** \[subjects\]: [tentacles,](https://danbooru.donmai.us/posts?tags=tentacles)[penis tentacle,](https://danbooru.donmai.us/wiki_pages/penis_tentacle)[veiny tentacles,](https://danbooru.donmai.us/posts?tags=veiny_tentacles)[tentacle sex,](https://danbooru.donmai.us/wiki_pages/tentacle_sex) [tentacle pit,](https://danbooru.donmai.us/wiki_pages/tentacle_pit) slimy, [levitation,](https://danbooru.donmai.us/posts?tags=levitation) [restrained,](https://danbooru.donmai.us/posts?tags=restrained) [suspension,](https://danbooru.donmai.us/posts?tags=suspension) lifted

## Subject

- **Multicolored hair** \[subjects\],\[hair\]: [multicolored hair](https://danbooru.donmai.us/posts?tags=multicolored_hair), [gradient hair](https://danbooru.donmai.us/wiki_pages/gradient_hair), [colored tips](https://danbooru.donmai.us/wiki_pages/colored_tips), <color-1> hair, <color-2> hair
- **Smirk face** \[body.express\]**:** [smirk](https://danbooru.donmai.us/wiki_pages/smirk), [smug](https://danbooru.donmai.us/wiki_pages/smug), [frown](https://danbooru.donmai.us/wiki_pages/frown), [doyagao](https://danbooru.donmai.us/wiki_pages/doyagao),
- **Yakuza** \[subjects\],\[body\]: [yakuza](https://danbooru.donmai.us/wiki_pages/yakuza), [tattoo](https://danbooru.donmai.us/wiki_pages/tattoo) ([irezumi](https://danbooru.donmai.us/wiki_pages/irezumi), [full-body](https://danbooru.donmai.us/wiki_pages/full-body_tattoo), etc.), [piercing](https://danbooru.donmai.us/posts?tags=piercing) ([nose,](https://danbooru.donmai.us/wiki_pages/nose_piercing) [navel,](https://danbooru.donmai.us/wiki_pages/navel_piercing) [nipple](https://danbooru.donmai.us/wiki_pages/nipple_piercing), etc), [makeup](https://danbooru.donmai.us/posts?tags=makeup)
- **Demon** \[subjects\],\[body\]: [demon](https://danbooru.donmai.us/wiki_pages/demon), [demon girl](https://danbooru.donmai.us/wiki_pages/demon_girl), [horns](https://danbooru.donmai.us/wiki_pages/horns) ([demon,](https://danbooru.donmai.us/wiki_pages/demon_horns) [dragon,](https://danbooru.donmai.us/wiki_pages/dragon_horns) [curled,](https://danbooru.donmai.us/wiki_pages/curled_horns) [cow,](https://danbooru.donmai.us/wiki_pages/cow_horns) etc), [tail](https://danbooru.donmai.us/wiki_pages/tail) ([demon,](https://danbooru.donmai.us/wiki_pages/demon_tail) [raised,](https://danbooru.donmai.us/wiki_pages/tail_raised)etc), [colored skin](https://danbooru.donmai.us/wiki_pages/colored_skin) ([red,](https://danbooru.donmai.us/wiki_pages/red_skin) [black,](https://danbooru.donmai.us/wiki_pages/black_skin) etc.)
- **Goblin** \[subjects\],\[body\]: [goblin](https://danbooru.donmai.us/wiki_pages/goblin), [female goblin](https://danbooru.donmai.us/wiki_pages/female_goblin), [green skin](https://danbooru.donmai.us/wiki_pages/green_skin), [pointy ears](https://danbooru.donmai.us/wiki_pages/pointy_ears), [fangs](https://danbooru.donmai.us/wiki_pages/fangs)
- **Furry** \[subjects\]: [furry](https://danbooru.donmai.us/posts?tags=furry), [furry female](https://danbooru.donmai.us/wiki_pages/furry_female), furry with \[[furry](https://danbooru.donmai.us/wiki_pages/furry_with_furry) / [non-furry](https://danbooru.donmai.us/wiki_pages/furry_with_non-furry)\], <color> fur, [fang](https://danbooru.donmai.us/posts?tags=fang) ([s](https://danbooru.donmai.us/wiki_pages/fangs))
