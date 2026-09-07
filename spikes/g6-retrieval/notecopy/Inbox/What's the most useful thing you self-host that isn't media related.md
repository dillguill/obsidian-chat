---
title: What's the most useful thing you self-host that isn't media related?
source: https://www.reddit.com/r/selfhosted/comments/1ucd7cj/whats_the_most_useful_thing_you_selfhost_that/
cover:
author: "[[sarox-dev]]"
published: 2026-06-22
description: "I run the usual stuff: Pi-hole, Jellyfin, NAS. The basics. Lately I've been diving into self-hosting AI tools and it's a different beast ent"
type: thread
tags: [apps, self-host]
---
I run the usual stuff: Pi-hole, Jellyfin, NAS. The basics. Lately I've been diving into self-hosting AI tools and it's a different beast entirely compared to just running a media server.

The hardware requirements alone are a conversation. A 4K movie stream uses your GPU for transcoding maybe 5% of the time. Running a local LLM pins your GPU at 100% for minutes straight. The power draw difference is noticeable.

But the tradeoff is interesting: no API costs, no rate limits, no random service shutdowns. Once the hardware is in place, it's yours. You can throw a million requests at it and the only cost is the electricity.

I'm curious what non-obvious things people in this community self-host. What's the weirdest or most useful thing you run that surprised you with its value?

---

## Comments

> **asimovs-auditor** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot2yy8p/) · 1 points
> 
> Expand the replies to this comment to learn how AI was used in this post/project.

> **teranex** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot352q8/) · 182 points
> 
> Syncthing
> 
> > **sarox-dev** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot36jwo/) · 35 points
> > 
> > Me too. I use it to sync obsidian vaults between my devices.
> > 
> > > **motz31** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3hf6h/) · 33 points
> > > 
> > > There is a Community Plugin for Obsidian that let's you live sync your Vault between devices. It's called Self-hosted LiveSync.
> > > 
> > > > **lifeisagameweplay** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot47ogt/) · 4 points
> > > > 
> > > > Does it sync with the mobile app too?
> 
> > **ReadyAimTranspire** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot6p2ys/) · 3 points
> > 
> > Syncthing rules. I only use it for my phone but man it's so good.

> **TropicoolGoth** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot31ror/) · 167 points
> 
> To expand on the others. Silver bullet notes, donetick, omada controller, bytestash, kara keep,vault warden, lube logger, and parts db.
> 
> Edit:
> 
> [Silverbullet](https://silverbullet.md/) - Live editor for note taking
> 
> [Donetick](https://donetick.com/) - Task manager
> 
> [Omada Controller](https://www.omadanetworks.com/us/business-networking/omada-controller-cloud-software/omada-software-controller/) - Setup and configure your TP Link devices
> 
> [Bytestash](https://github.com/jordan-dalby/ByteStash) - Code snippets. Super useful for those one off terminal commands im always forgetting
> 
> [Kara Keep](https://karakeep.app/) - Once was named Hoarder, an awesome bookmark manager, with mobile apps
> 
> [Vault Warden](https://github.com/dani-garcia/vaultwarden/) - Password manager
> 
> [Lube Logger](https://github.com/hargata/lubelog) - Vehicle maintenance tracker
> 
> [PartsDB](https://docs.part-db.de/) - Keep track of all your electronic parts.
> 
> > **Plastic-Fisherman465** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3o0ob/) · 44 points
> > 
> > I had to search for Lube Logger…was not disappointed
> > 
> > > **maninthebox911** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3whkv/) · 10 points
> > > 
> > > Wouldn't want to run out!
> > > 
> > > **los0220** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot605rr/) · 5 points
> > > 
> > > Wow, I've been looking to replace fuel.io for some time now
> 
> > **sarox-dev** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot32nac/) · 25 points
> > 
> > Haven't even heard of these. Only vault warden.
> > 
> > **EslamMohamed94** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3djkp/) · 10 points
> > 
> > Amazing !! I’ve been looking for a tool similar to toby chrome extension ([https://www.gettoby.com/](https://www.gettoby.com/)) but self hosted for organizing bookmarks. I just saw kara keep and it looks good. Do you have thoughts/feedback about it ?
> > 
> > > **colonelmattyman** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4mmnz/) · 8 points
> > > 
> > > I've used Karakeep for a while. It's great.
> 
> > **petersrin** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot37igz/) · 7 points
> > 
> > Silver note! Love it. Also making use of kan.bn and home box
> > 
> > **JCandle** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3djqi/) · 14 points
> > 
> > I know I can look these up, but outside of Bitwarden, do you mind listing your use cases?
> > 
> > **Excellent\_Pass8718** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3yz6h/) · 3 points
> > 
> > that parts db sounds way more organized than my desk drawer
> > 
> > **saxxonpike** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4ab94/) · 3 points
> > 
> > I also run Omada controller, and recommend it for anyone else who uses Omada compatible networking. My OC200 failed recently and I couldn’t seem to recover it. The docker container saved me.
> > 
> > > **phigo50** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4tzfa/) · 3 points
> > > 
> > > How does the performance compare to the physical controller? For a dedicated device I find it so sluggish, it's not even a very big network (5 switches and an AP) but switching between pages takes multiple seconds. I seem to remember back when I installed it that performance was seen as an issue. I don't know if it's badly written software or the physical controller is just woefully underpowered.
> > > 
> > > > **Placed-ByThe-Gideons** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot54q1m/) · 3 points
> > > > 
> > > > The oc200 is far slower than the docker controller. In my experience.
> 
> > **Designit-Buildit** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot6p1kb/) · 3 points
> > 
> > Any idea how silverbullet compares to triliumnext? I've been using trilium for a while. And while I like it, it isn't quite what I want.

> **Chinook146** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3ed27/) · 90 points
> 
> Other than what everyone else has listed...actual budget
> 
> > **attyluccio** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4clez/) · 23 points
> > 
> > +1 for actual budget.
> > 
> > switched from YNAB a couple years ago and never looked back.
> > 
> > It is miles ahead (I'm from EU and with ActualBudget I can bank sync). The community is top and devs are great.
> > 
> > **mark200us** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot7pgw6/) · 4 points
> > 
> > \+ for Actual Budget here as well - I’m in Aus so no bank syncing, I’ve built an api wrapper with a basic react front end I drop csv in:  
> > \- LLM looks at actual budget past categorisation  
> > \- applies categorisation for new import  
> > \- pushes to actual
> > 
> > And a bunch of front end “retirement planning” that pulls actual from the app and allows me to do scenarios
> > 
> > **sarox-dev** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3ek20/) · 5 points
> > 
> > You manage your budgt using self hosted apps?
> > 
> > > **Chinook146** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3f9e3/) · 29 points
> > > 
> > > Yeah, I learned envelope style budgeting a long time ago & used ynab for years. Then found actual budget & switched to that. If that style of budgeting works for you, then it's great
> > > 
> > > > **MechanicStriking4666** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3q3q3/) · 14 points
> > > > 
> > > > I use actual budget, too. It’s great! It’s probably the self-hosted software that I use the most outside of plex.
> > > > 
> > > > **BrilliantSebastian** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5div0/) · 6 points
> > > > 
> > > > This is the way. I certainly don't connect them to my banks though. We do all the data entry manually. It's a chore, but I'm not worried about data breaches and access to my actual money. We pay everything with credit card. So the only thing our liquid assets are connected to is the credit card company. So if anything is ever compromised, it's the major credit card chain.
> > > > 
> > > > And if anyone ever hacks my credit card, I could give a piss, it's not my money.

> **ph33rlus** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3fkzv/) · 42 points
> 
> Home Assistant. Changed my life
> 
> > **sarox-dev** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3g69d/) · 8 points
> > 
> > Everybody mentions home assistant. I want to explore it so bad rn but I can't😭
> > 
> > Where do I start?
> > 
> > > **ErraticLitmus** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot443dp/) · 17 points
> > > 
> > > I've explored it but am struggling to yell from the rooftops how good it is. Yes, it's got some functionality. But I guess I just don't have or need the level of automation that most people have!? I have a handful of smart lights and some smart PowerPoints but that's about it. Still waiting for the use case that will blow me away
> > > 
> > > > **No-Shortcut-Home** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot57617/) · 8 points
> > > > 
> > > > I am one of those weird people that want zero "smart" stuff in my home. Yes, I host a ton of services in my "single stack" home lab, but I prefer physical switches and no cameras or listening devices inside my home. Doesn't matter if I control everything, I just don't want that stuff. So not sure how this would benefit me at all.
> > > > 
> > > > > **nubbin9point5** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5v2vk/) · 9 points
> > > > > 
> > > > > Living in a 3-story row home, being able to check and adjust locks, thermostat and lights from the bedroom without having to go down and up multiple stairs is very nice when you’re already ready for bed, or it’s 3am and you wake up sweating. Add things like window or door sensors for information or to tie in to your thermostat, automatic blinds, gradual light alarms instead of just a loud, jarring sound and easy physical scene switches like the Leviton Scene Controller, you maintain all of your physical switches, but have a quick, singular reference for the status of everything and physical switches that don’t require a smart phone to operate. It’s not necessary, but nice to get everything consolidated and working in one place.
> > > > > 
> > > > > **FriedCheese06** · [2026-06-24](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/otgsc1a/) · 6 points
> > > > > 
> > > > > You do not need listening devices nor cameras. You can keep your physical switches functional. But, everyone has their use-case in there somewhere.
> > > > > 
> > > > > To give some ideas.
> > > > > 
> > > > > I have millimeter wave radars in the bathrooms to automate lights based on actual presence and not just motion. I have humidity sensors in the bathrooms that automatically turn the exhaust fans on/off when the shower is run.
> > > > > 
> > > > > I have an iotaWatt installed in my main electric panel to keep tabs on usage. This allows me to track costs and identify faulty/failing electronics.
> > > > > 
> > > > > I have water leak sensors under each toilet and sync valve, tied to an automation that sends notifications if a leak is detected and will shut off the main water line (with a smart valve controller).
> > > > > 
> > > > > I installed smart bulbs in my bar lighting (central point of the first floor and by the back door). I use one for a visual notification for when the washer or dryer is done (does not turn on if someone is in the laundry room and turns off when someone enters after). The other is for notifying that a fence gate is open.
> > > > > 
> > > > > I have an Uber Eats integration setup using rest sensors to pull order information, status, and to push notifications with updates (ordered, picked up, delivered).
> > > > > 
> > > > > I have two snake enclosures. Home Assistant is my central monitoring point for the climate and handles lighting based on schedule, exhaust based on heat, plus I have an esp keypad to log events (feeding, shedding, etc.) that drive reminders (time to feed, time to change water, etc.).
> > > > > 
> > > > > I have PetLibro feeders for the dogs and use home assistant to trigger feedings. Timing is adhoc because my dogs are weird but could even auto feed at select times.
> > > > > 
> > > > > I added a zwave sensor to the smoke detectors. This pushes a notification if they go off (a redundancy to my monitored alarm system) and will shut power off to the dryer (very common source of home fires) along with killing the HVAC (to minimize drafting for fire spread).
> > > > > 
> > > > > On the homelab front, I don't use half the monitoring integrations but I do have it running NUT to keeps tabs on the UPS. That feeds numerous automations from a simple alert when it goes on battery to phased shutdowns (both for lights and outlets around the house and stuff in the rack). This has really helped extend backup power to let the network stack be the last man standing on the sinking ship.
> > > > > 
> > > > > I use Life360 to track location of key devices. This handles automating some of the "just got home" stuff and is used as a condition for notifications (e.g., my kids don't live with me so they only get the Uber notifications when they're here).
> > > > > 
> > > > > Just a few off the top of my head.
> > > 
> > > > **xMasaru** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot6iyzt/) · 3 points
> > > > 
> > > > It can do a lot but simply using it for some smart lights is also a perfectly fine use case for Home Assistant. I love smart lighting and other simple stuff like turning off outlets when I'm not at home to not waste electricity.
> > 
> > > **lucads87** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3xgs6/) · 6 points
> > > 
> > > Get an old pc, a raspi or buy their Green box
> > > 
> > > > **crakked21** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot478pd/) · 2 points
> > > > 
> > > > I can’t find suitable stuff to do on home assistant. What do you do with it?

> **CriticalAPI** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot30w8w/) · 34 points
> 
> Home Assistant, Ollama, Zabbix (Monitoring System), Frigate NVR with Coral TPU, Octoprint (3D Prining Webserver), Mailcow (Email Server), Teamspeak (kinda media related), also some self developed apps.
> 
> > **SirDarknessTheFirst** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot444la/) · 6 points
> > 
> > Surprised I had to scroll this far to see Home Assistant mentioned. This is top of the list for me, even including media things.
> > 
> > > **wenestvedt** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4k2ne/) · 7 points
> > > 
> > > All hail Home Assistant.

> **cascer1** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot353ke/) · 56 points
> 
> 100% an adblocker (whichever flavor you like)
> 
> It's so jarring to be away from home and forget to enable my VPN. The fewer ads I see at home, the more ridiculous the unfiltered internet becomes.

> **Patriark** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot316m8/) · 102 points
> 
> Honestly, the monitoring stack. Grafana, Loki, Prometheus, some metrics exporters etc. I get alerts whenever something deviates outside expected levels and SLO scores.
> 
> Often I discover issues before they manifest problematic symptoms. Was quite a lot of work to set it up though.
> 
> > **nicktheone** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot349jn/) · 24 points
> > 
> > What do you host that is so crucial to monitor this closely?
> > 
> > > **Patriark** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3616k/) · 53 points
> > > 
> > > I do it for the learning experience. Nothing I self-host is strictly necessary, just an exercise in digital sovereignty and fun hobby.
> > > 
> > > > **nicktheone** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot37q6f/) · 8 points
> > > > 
> > > > I see. I'm the same but since the question was about the most useful thing we host I was wondering what crucial services you were monitoring this close.
> > > > 
> > > > > **Patriark** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3881c/) · 20 points
> > > > > 
> > > > > Jellyfin, Nextcloud, audiobookshelf, home assistant, pihole+unbound, Immich… the regular stuff.
> > > > > 
> > > > > But it’s a great feeling to get a alert to my phone when some error spikes, then ssh in and fix it even before I notice any degradation.
> > > > > 
> > > > > The goal was to learn enterprise grade monitoring skills.
> > 
> > > **PssyGotWifi** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot36qtj/) · 7 points
> > > 
> > > Your question assumes you need crucial things to bother monitoring closely.
> 
> > **Browsinginoffice** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3oi4o/) · 2 points
> > 
> > Could you share more? What do you monitor and how do you compute the scores

> **Lehovron** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3iixy/) · 19 points
> 
> SearXNG

> **TedGal** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot32fzd/) · 17 points
> 
> Seafile. Daily Im using various devices and having a super fast way to have my currently working files on all of them is super useful to me.
> 
> Edit to add: Gotify. Small bash scripts and I get notified for everything that matters to me: update of self-hosted services l, something going wronng on my server or really anything else.
> 
> Komodo: priceless because teamed with Gotify I really never have to worry about services being vulnerable due to old versions and I can stop containers I don't use daily to free up some RAM without having to SSH into the server and use CLI

> **sessamekesh** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot33zy4/) · 16 points
> 
> Forgejo instance + a pretty beefy runner was my first, and the thing that got me into self hosting. 
> 
> I have a bunch of spare compute so I also have it set up to run folding@home when I have excess free solar power (home batteries full). For the warm fuzzies.
> 
> I also have a no-GPU llama.cpp instance running for the (surprisingly often) times I want to just point a mid-grade model at a problem and let it churn for a bit while I go take a walk or eat dinner or whatever.

> **staycoolstewy** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3ezs1/) · 14 points
> 
> trillium for the most used. Learning esp32 embedded pcbs take home assistant to another level.  
> I now have my garage door on hey siri command, all my gates have magnets so I can tell if they’re open. Friagte is awesome as well.

> **yuri0r** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3897k/) · 13 points
> 
> Otterwiki turned out to be amazing for ttrpg campaigns. Sort of a shared notes. people can have little spaces for their characters. Session notes are shared and curated into a timeline. DM can share what would readily available knowledge.
> 
> The rest is pretty much just piracy and media related.

> **Angelsomething** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3cenh/) · 11 points
> 
> Does home assistant count? Because it's amazing. It has become the protagonist of my setup. 

> **DangerouslyUnstable** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot57fs2/) · 21 points
> 
> People here are pretty down on vibe-coded apps, and mostly for pretty good reasons. But I think that making a completely personalized piece of software that solves a very specific need (maybe even completely unique to you!) is kind of transformative. I'm running I think 4 different projects that I made from scratch with claude code to solve specific problems. I don't share or advertise them, because they aren't meant for, or really ready for, general use (and likely never will be, since that's not the goal). They are meant to be used by me.
> 
> As an example: I needed a freezer inventory system, and for reasons that aren't worth going into, Grocy and other existing solutions didn't fit my needs. I made a super lightweight system that does the very specific thing I needed. It took very little time and runs on almost no resources. It's most likely completely useless for almost anyone other than me, but it doesn't need to be.
> 
> So my answer would be to find some small thing in your life that could potentially be fixed by software, but is too niche to have an existing solution, and make it.

> **moonlighting\_madcap** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3ev5d/) · 10 points
> 
> Home Assistant, 100%.
> 
> Pangolin is a close second.

> **Hrafna55** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot35itm/) · 14 points
> 
> It's fairly obvious one. Email.
> 
> Everyone says not to do it but I have hosting my email for over ten years now and it's fine.
> 
> I think the crucial difference is I have a static IP from my ISP and they permit customers to run services on a residential line.

> **Illbsure** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot368w4/) · 7 points
> 
> N8N is fun

> **\-Chemist-** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot32y0b/) · 13 points
> 
> - Karakeep - can feed it webpages and it will automatically tag everything using AI, making it easy to find and retrieve the info later
> - FreshRSS - lets me read news I’m interested in and filter out everything I’m not
> 
> > **brpw\_** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3j7hm/) · 8 points
> > 
> > I tried freshrss recently but it felt so dated compared to something like Inoreader. Really wanted to self host but just couldn't face the downgrade in design and UX. 
> > 
> > > **harperthomas** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3o80q/) · 7 points
> > > 
> > > Worth noting that freshrss has pretty good integrations with other apps. I don't like reading anything with it directly but it acts as the backend for the android app capy reader.
> > > 
> > > **WilyDeject** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3mh74/) · 3 points
> > > 
> > > I love Inoreader

> **Kinsman-UK** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot32jkl/) · 6 points
> 
> To add to the others: Linkwarden, UpSnap, Uptime Kuma.
> 
> > **PssyGotWifi** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot36ga0/) · 6 points
> > 
> > Love Kuma. You tried automating it with Terraform before?
> > 
> > [https://github.com/Lebowski89/homelab/tree/main/terraform/uptime-kuma](https://github.com/Lebowski89/homelab/tree/main/terraform/uptime-kuma)

> **Axiol** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot34i08/) · 6 points
> 
> I just finished setting up and migrating my notes to Leafwiki as a way to not pay for Obsidian sync. I’ll miss the Excalidraw integration. But, otherwise, it direct goes to my top apps

> **HornyForYaml** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3rpx5/) · 6 points
> 
> Foundry VTT

> **\_alright\_then\_** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3whqa/) · 6 points
> 
> It's not close, it's homeassistant.
> 
> I would throw out all media related self hosted stuff if I had to choose between that and homeassistant

> **dieterdistel** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot34sy8/) · 5 points
> 
> Traccar (Location Tracking), NetAlertX (Network Management), soon: PaperlessNGX (document management), maybe: FlexiSIP ( voip)

> **OddConsideration2210** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot37gp0/) · 5 points
> 
> Memos, vaultwarden, syncthing, pingvin

> **Ggsam3** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3djnk/) · 5 points
> 
> Nginx, paperless and vscode web

> **syst3mctl** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3tue1/) · 5 points
> 
> Among a lot of other things :
> 
> ERP / CRM : Dokos (ERPNext fork for french market)  
> Penpot : Collaborative Figma alternative  
> Adguard Home : protect your home internet access with this anti tracking dns pi hole alternative  
> Uptime Kuma: monitor your apps online  
> Nginx proxy manager : a webapp to manage your proxy.
> 
> For AI:  
> LLAMA.cpp (llama-server for API + Webapp)  
> OpenwebUI : for a complete webapp connected to your llama.cpp  
> SearxNG : Meta web search engines ables to render results in JSON (compatible with openweb ui)

> **Centho\_** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4c7yn/) · 5 points
> 
> A telephony system
> 
> I'm a streamer and scambaiter and I call scammers on Twitch and for my own safety I'd rather not use my own phone number
> 
> So to get around this issue I have set up two different phone systems with different purposes
> 
> One is using a 4G dongle, a Simcom 7600 to be precise that I can use just like a regular phone to place phone calls, the other one is using something a bit stranger it's using an old Huawei phone to call scammers and receive calls via bluetooth, just like you could use Bluetooth in a car to dial and receive calls it acts the same here
> 
> It's all set up on a proxmox server that has a container that behaves like a network switch that supplies different kinds of VPN to the machines linked to that subnet, I can either use a tailscale instance, wireguard VPNs or initiate a Tor connection
> 
> It's a real hassle to build all of this but once it's done, everything works great

> **Wrong-booby7584** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5tl26/) · 5 points
> 
> CUPS !!
> 
> The whole family can print to an ancient laserjet from any device.
> 
> > **TheSpatulaOfLove** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5ztap/) · 5 points
> > 
> > Do the lights dim slightly when that thing fires up?

> **WhoDidThat97** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot38jd2/) · 4 points
> 
> Dumb really, but my homepage of links to all my other self hosted services 

> **sykoman21** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4f223/) · 4 points
> 
> Firefox docker that is accessible via nginx proxy manager. Very useful to get around corporate firewalls.

> **durgesh2018** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot57vvj/) · 4 points
> 
> Dockhand is really awesome to accumulate your different docker environments/machines.

> **Fit\_Albatross\_8947** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3aznc/) · 7 points
> 
> Homebox for documenting my collectibles,. AdventureLog as a travel diary. Bookstack for documenting my server, baking recipes and my DnD campaign notes.

> **the-prowler** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot35ocz/) · 3 points
> 
> Gitlab. I've run my own for a long time now and I use it every day.

> **Seke420** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot38ck2/) · 3 points
> 
> Probably the most useful for me and my family is Vaultwarden paperless and Immich for the others is a nice to have like Lubelogger etc to keep track of my cars or Darwarich. Edit: Totally forgot Pi-hole - Unbound combo and for even more privacy 4get and or degoog.

> **diablette** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3cc24/) · 3 points
> 
> Homebox for home inventory
> 
> Homepage (gethomepage) for a custom homepage

> **Dramatic\_College\_273** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3cj1m/) · 3 points
> 
> Crowdsec - it is so useful to actually see what is probing or trying to actually exploit known vulnerabilities or bad actors trying to talk to my home network. People on here is massively exaggerating how bad it is. Most is just automatic bots getting banned immediately because a probe is obvious and geoblocking blocks most anyway.
> 
> Planning to do a whole SIEM setup on my home network in the future so I can monitor devices that connect to my guest network or our personal devices at home, to get notified if they have already been compromised and trying to traverse the LAN. Could be fun to be able to tell a friend they need to factory reset their phone because they have been compromised.

> **CWagner** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3ga95/) · 3 points
> 
> Those are used far more than the media ones (except Navidrome): Home Assistant, Actual Budget, Unifi Controller, Comma Feed (RSS), Prosody (Jabber Server)

> **Stooovie** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3o1sj/) · 3 points
> 
> Nextcloud and Home Assistant

> **DumbassNinja** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3rlob/) · 3 points
> 
> SyncThing
> 
> > **sarox-dev** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3sbtj/) · 3 points
> > 
> > I also use that for my obsidian vaults.
> > 
> > > **DumbassNinja** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3tdjl/) · 3 points
> > > 
> > > I use it to completely sync my main PC and NAS (both have 8tb drives in them, I felt safer having a drive in each computer rather than 2 in the NAS plus local files on the PC), a folder for my D&D computer's resources, and Obsidian across every device I own. I think thr only service I use that would be more important is Tailscale and that's not self hosted.

> **Next-Difference-9773** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3vkur/) · 3 points
> 
> It’s a tie between Immich and CopyParty for me.
> 
> Immich: Don’t have to pay iCloud/Google Photos to store my photos/videos. Neither does my mom, she uses it a lot because she’s a big photo person.
> 
> Copyparty: Don’t have to pay Google Drive to store my meme stash or backups of game mods (mod authors are notorious for taking down their own stuff).
> 
> They’re the only 2 things I make regular backups of because they’re both so important to me.

> **RelevantTee6** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3x3gc/) · 3 points
> 
> cups to make old printer capable again - send through wifi

> **Raikayoshi** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3xswy/) · 3 points
> 
> Romm !
> 
> > **ErraticLitmus** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot43m4q/) · 5 points
> > 
> > Love this. I also use grout in MuOS on my handheld device for syncing roms and saves. It's awesome

> **Cautious-Hovercraft7** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4cda5/) · 3 points
> 
> Paperless

> **buzzbuzz17** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot4r5in/) · 3 points
> 
> I made an internet status web page. A container that pings all the network devices in my house as well as key internet gateways, then hosts a webpage that makes a determination on what to do to troubleshoot if the internet is acting funny. Means my wife can usually fix the internet herself while I'm away.
> 
> Options: Reboot Wifi (only accessible over cable, obv) Reboot reboot router Reboot Cable modem Nothing you can do, it's the internet's fault
> 
> It was my first try at containers, and I didn't understand container management at all. I dread having to modify it when we get a new ISP someday. Still running 6 years later tho. The internet speed test I included broke for a couple years and then magically fixed itself again somewhere along the way without me doing anything, haha.
> 
> Also another vote for vaultwarden.

> **farva\_06** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5c96s/) · 3 points
> 
> Authentik. SSO is the best!

> **craigmdennis** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot5weuk/) · 3 points
> 
> I run:  
> \- VMs of long lost computers (and have backups of the HDDs)  
> \- Air Connect  
> \- Home Assistant  
> \- AdGuard  
> \- Kara keep (formerly Hoarder)  
> \- Downtify (Spotify Downloader)  
> \- Immich  
> \- Uptime Kuma  
> \- Frigate

> **revisionincarnate** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot73h7y/) · 3 points
> 
> Vaultwarden. My parents use it so I have access to their things if they'd ever come to pass (never happening btw, they're living forever)

> **cuntywunty69** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3fjqy/) · 5 points
> 
> ...

> **frankster** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot33xpg/) · 10 points
> 
> I don't buy that this post is 90% not ai. It feels like70% ai. 30% human

> **panserbj0rne** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3528o/) · 4 points
> 
> I host a script that clips all the coupons at my local grocery store. It has saved me hundreds of dollars and hours of time that I don’t have to manually click 100+ coupons. I always just get the best price. Love it.

> **whiteamphora** · [2026-06-22](https://reddit.com/r/selfhosted/comments/1ucd7cj/comment/ot3kphy/) · 4 points
> 
> Hermes agent :) server maintenance, coding, advices on my local llm