---
title: Storing models and LORAs on an external hard drive?
source: https://www.reddit.com/r/drawthingsapp/comments/1mfvicf/storing_models_and_loras_on_an_external_hard_drive/?share_id=hmT8Xahsesm5oT3aRZL3_&utm_content=1&utm_medium=ios_app&utm_name=iossmf&utm_source=share&utm_term=22
cover:
author: "[[Theomystiker]]"
published: 2025-08-02
type: doc
tags: [draw-things, LoRA, macOS]
---
DrawThings is a really interesting macOS app that I found while searching for a replacement for Diffusionbee. However, I am dissatisfied with the fact that the models cannot simply be stored on an external hard drive via a symbolic link, as is the case with Diffusionbee. My internal hard drive is 256 GB and has very little free space, which is unfortunately far too small to use DrawThings as comprehensively as the outdated Diffusionbee. Does anyone have a solution to this problem? Are there any plans on the part of the developers to officially store the models on an external SSD?

---

## Comments

> **Quiet\_Issue\_9475** • [10 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6ka4ac/) •
> 
> You can store all your Models, Loras, ControlNet Models etc. on an external device, you need select the device (where you want to store your Models) first.
> 
> Click where you can select your model  
> Click on Manage  
> There you can now select your External Device for future model storage.  
> ~~You may need to re-import the models you already have, so DrawThings register the new Location of the Models.~~
> 
> ![Comment Image](https://preview.redd.it/storing-models-and-loras-on-an-external-hard-drive-v0-ikboayszangf1.png?auto=webp&s=421363cf5e3d62e87fe325122dd4f1cfa9dcd590)
> 
> > **liuliu** • [4 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6lhz7o/) •
> > 
> > You can move a model to external drive via selecting the "..." Next to the model and there is a move to external option.
> > 
> > > **Quiet\_Issue\_9475** • [2 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6nrxa9/) •
> > > 
> > > Ohh, yes, i didn´t notice - you right, that makes the re-import of the models obsolete 👍
> 
> **Petrichor-Vibes** • [2 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6p3nxi/) •
> 
> Wow I didn’t know about this. Models are already taking up 700+ gigs on my iPad, so this is great news. Thanks.
> 
> **Theomystiker** • [2 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6qyc1j/) •
> 
> Thank you very much for your reply. Now it works as desired and everything is saved to the external drive.
> 
> **fscheps** • [1 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n76vkpq/) •
> 
> Thanks! 😉

> **liuliu** • [4 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6lhubq/) •
> 
> Draw Things is sandboxed, unlike DiffusionBee (which has access to all your disk). So symbolic link won't work (otherwise that will be a sandbox escape). You can give explicit permission to the app which external drive you will use to store the model like the screenshot by the other user. In that way, Draw Things will only have access to that directory.

> **jonfoulkes** • [3 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6vdvb5/) •
> 
> While models and LoRA's can indeed live on an external, the SQLite files for the Sessions still must live on the internal drive, and those get quite large, as they contain the output images as well. Is there a setting I've missed that allows us to relocate those to the external drive?

> **usually\_fuente** • [1 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6k7npq/) •
> 
> Yes. If you use cloud compute, you can upload yours to their cloud. And use the main models in the cloud.
> 
> > **Theomystiker** • [2 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6kcvhc/) •
> > 
> > Actually, I'm looking for a way to store it on my own computer. For Diffusionbee, my folder for LORAs and models is about 300 GB in size, and I don't think I could get that anywhere in the cloud for free, not to mention a high-speed fiber optic connection! Of the 300 GB, I use most of the models regularly, as I have a wide range of interests when it comes to the variety of images I want to create!

> **TGMcLean** • [1 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/n6lzxfq/) •
> 
> I have no problem storing everything on an external drive – no need for symlinks. When you download the first model or LoRA, just specify where you want it to go. But be careful, as you don’t seem able to move downloaded ported models or LoRAs anywhere afterwards.
> 
> > **Herney\_Krute** • [1 points](https://reddit.com/r/drawthingsapp/comments/1mfvicf/comment/nkp4o17/) •
> > 
> > Is this on Mac? When I do this I only get an option to choose where generated images will be output.