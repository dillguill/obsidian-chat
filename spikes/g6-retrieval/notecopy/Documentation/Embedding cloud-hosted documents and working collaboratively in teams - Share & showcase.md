---
title: Embedding cloud-hosted documents and working collaboratively in teams - Share & showcase
source: https://forum.obsidian.md/t/embedding-cloud-hosted-documents-and-working-collaboratively-in-teams/30641
author: "[[Obsidian Forum]]"
published: 2022-01-15
description: If you want to embed documents hosted in the cloud (surveys, word processors or online spreadsheets for collaborative work, etc.), it can be achieved using iframe but you must pay attention to some details and tricks. E…
type: doc
tags: [obsidian]
---
[Nils.Srvd](https://forum.obsidian.md/u/Nils.Srvd)

If you want to embed documents hosted in the cloud (surveys, word processors or online  
spreadsheets for collaborative work, etc.), it can be achieved using iframe but you must pay attention to some details and tricks.

**Embedding documents hosted in the cloud**

Can I, for example, view documents hosted on Google Drive from Obsidian? Of course yes. Any document hosted on Google Drive and with read-only permission for any user with the link can be displayed as an iframe in Obsidian’s markdown notes. For example, if someone generates a spreadsheet in Google Docs and shares the link with you, you could use the following iframe:

```
<iframe src="https://docs.google.com/spreadsheets/d/1nWyYBng8_BvLeUoX_O8fpRmy8JgSeH8tzD5xEj7Kt1w/edit?usp=sharing" style="border:0px #ffffff none;" name="myiFrame" scrolling="no" frameborder="1" marginheight="0px" marginwidth="0px" height="100%" width="100%" allowfullscreen></iframe>
```

I recommend deploying these hosted-in-the-cloud resources within isolated notes, and never directly within a note with a lot of text, since the latter can cause some difficulties in navigating within the note in question. For example, the spreadsheet for the above iframe can be seen this way in an isolated note - *the possibilities of interaction there are incredible*:

[![Interacting with Google Docs. Fig. 1](https://forum.obsidian.md/uploads/default/optimized/3X/c/f/cff7196417244357668f534dea9e18b344ecbed3_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/c/f/cff7196417244357668f534dea9e18b344ecbed3.png "Interacting with Google Docs. Fig. 1")

Especially in full screen mode:

[![Interacting with Google Docs. Fig. 2](https://forum.obsidian.md/uploads/default/optimized/3X/4/8/48c12e19c2a01996977f609b8cc1924b3e61ba5a_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/4/8/48c12e19c2a01996977f609b8cc1924b3e61ba5a.png "Interacting with Google Docs. Fig. 2")

You can try embedding the iframe above in an isolated Obsidian note to try it out for yourself. Then, of course, that note could be embedded in any other note using the transclusion statement by adding an exclamation mark in front of the \[\[wiki link\]\] to the document (which, in Obsidian, represents a “backlink”):

```lua
![[Name of the note]]
```

Of course, the same can be done with any type of document present in Google Docs as long as you have *Access Rights*; whether they are documents with access in reader, commenter or editor mode. For example:

---

- **Google documents** (*try embedding the iframe in an isolated note*)
```
<iframe src="https://docs.google.com/document/d/1zrmNwLJLm78KlrOYwYOpCKAabd_KA6JlskEbRB1d5KM/edit?usp=sharing" style="position:absolute; top:0; left:0; width:100%; border:none; height:100%;">
```

---

[![Interacting with Google Docs. Fig. 3](https://forum.obsidian.md/uploads/default/optimized/3X/0/8/0861e6763a2bef243efa3bc72316d75fff3cd90a_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/0/8/0861e6763a2bef243efa3bc72316d75fff3cd90a.png "Interacting with Google Docs. Fig. 3")

---

- **Slides** (*try embedding the iframe in an isolated note*)
```
<iframe src="https://docs.google.com/presentation/d/1QNqiw0BWVw2V8338i0Y-ZkvcAfJWWOq9IF3b8SzP1fU/edit?usp=sharing" style="position:absolute; top:0; left:0; width:100%; border:none; height:100%;">
```

---

[![Interacting with Google Docs. Fig. 4](https://forum.obsidian.md/uploads/default/optimized/3X/6/0/6077c6d65c74726d5be164f2f002455a30b517f9_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/6/0/6077c6d65c74726d5be164f2f002455a30b517f9.png "Interacting with Google Docs. Fig. 4")

---

- **Interactive maps** (*try embedding the iframe in an isolated note*)
```
<iframe src="https://www.google.com/maps/d/edit?mid=11rxS0eTXCutI31eqp8T5Aw-KcQ3so8Wd&usp=sharing" style="position:absolute; top:0; left:0; width:100%; border:none; height:100%;">
```

---

[![Interacting with Google Docs. Fig. 5](https://forum.obsidian.md/uploads/default/optimized/3X/4/4/44edea0641a898bbb3615b823eb9ac853367da23_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/4/4/44edea0641a898bbb3615b823eb9ac853367da23.jpeg "Interacting with Google Docs. Fig. 5")

---

… and so on. And the same applies to any other collaborative cloud document from platforms such as DropBox, OneDrive, etc.

Of course, if your cloud document does not have access permissions of any kind then you will have to log in from the document embedded in the Obsidian note; i.e., from within Obsidian. The credentials will be recorded in Obsidian’s cache.

Now, clearly those files are outside of Obsidian and are difficult to integrate into our *knowledge base* (i.e., in locally hosted markdown notes that contain highly useful links). At most, after collaborating with other participants we can download the file, bring it to our vault and store it there. Those downloaded files still cannot be displayed in Obsidian (version 0.13.19) markdown notes unless they are images, videos, PDFs and not much else.

But if you want a good strategy for integrating them into your vault and Obsidian’s Tree Network then it can be highly efficient to create a markdown note next to the non-markdown file (e.g., an excel file) downloaded from the cloud, named identically and/or housed in the same folder (I personally have a hierarchical folder system that I respect sacredly).

The markdown note will present a link to the non-markdown file, which can now be rendered efficiently on your Graphic Network (both of them). The markdown note can serve as a metadata note for the non-markdown file. At the same time, that markdown note will be able to present outgoing and backlinks to other notes. This is the best workaround I can think of for no-md files to integrate with Obsidian’s link system.

Whatever the case, it is clear that our problem is that all those non-markdown files are precisely non-markdown files and therefore we cannot place links inside them that communicate their contents with other notes in our vault. This problem is not solvable until we have a highly efficient and reliable “ *format converter* ” that allows all those files “ *to be read as markdown language* ”. So, to get around this problem, it’s best to work with markdown files whenever possible and avoid using (if it is possible) other file formats.

So, the big deal, can we work online and collaboratively with markdown files that can both

(1) be embedded in our Obsidian vault  
(2) be downloaded and integrated in our *knowledge manager system* in a highly efficient way whenever you wish

**Embedding external markdown files into Obsidian, from a cloud-hosted collaborative vault. Integrating those files into our KMS whenever we want**

[CryptPad](https://cryptpad.fr/) ([github](https://github.com/xwiki-labs/cryptpad)) is a crypto-based, and therefore private by design, alternative to popular office tools and cloud services similar to those offered by Google’s Drive and Docs products. All content stored on CryptPad is encrypted before it is sent, which means that no one can access your data unless you provide them with the keys. It is also a social network where you can add other users to work collaboratively on projects. Everything is encrypted: your profile, your account, your files, each element presents private keys and public keys.

CryptPad is a set of real-time collaborative editors and applications based on the Zero Knowledge cryptographic concept. Encryption done in your web browser protects data from other servers, from cloud intermediaries… It actually protects you even from the NSA because they can’t do much with encryption at this time. The secret encryption key is never sent to the server, but is available to javascript, so sharing the URL authorizes others to participate by viewing or editing the documents. This allows an extremely detailed management of the access rights to the documents, being able to be entirely private, visible but without the possibility of editing, with the possibility of editing for certain specific users or for anyone who has the link, with the possibility of ‘reding a single time’ followed by a self-destruction event of the document, etc.

CryptPad uses the Chainpad algorithm, which is a real-time collaborative editing algorithm based on Satoshi Nakamoto’s blockchains (‘ *blockchains* ’ because he created them all by creating the first one). This algorithm is capable of finding distributed consensus using a blockchain. In this way, the algorithm can avoid the need for a central server to resolve editing conflicts, and without the need to resolve conflicts, the server can keep track of the content being edited from the keyboard. Cryptpad offers WYSIWYG collaboration of texts and documents of very different formats, folder and subfolder systems, kanbas system for to-do list, the possibility to create public and private polls, store any type of file within those folders, including using them to create web pages, the possibility of embedding any of this content in websites and managing access to the different content embedded in the site, and a markdown-based collaborative Code Editor mode!

All documents worked on in CryptPad can be embedded in Obsidian in the same way as previously demonstrated with Google Docs. The big difference, in this sense, is the enormous degree of security and privacy offered by tools such as CryptPad, the rigorous file access and permissions management system, as well as the degree of versatility and adaptability of the documents created there. Let’s just say that it is a considerably more efficient and optimal collaborative work environment than the other alternatives mentioned. But there is another big difference: again, in CryptPad we can work collaboratively on markdown notes with the simplicity with which we would work in a Google Docs + Obsidian hybrid.

Thus, we can create a collaborative vault in the cloud with up to 1GB of storage to work with unrestricted amounts of users. We could even create an entire vault with read-only access so that others can reference our *knowledge base* and take from it what they want. We can also use those same files present in CryptPad to publish our online vault on a site. Or giving edit permission on some collaborative files, read-only permission on others, and so on. In this sense, CryptPad would be an infinitely more efficient tool than the other -privative- alternatives already mentioned to be used as a repository with which to publish our online vault. Once you want to take a CryptPad markdown note to add to your vault in Obsidian, all you have to do is download the file and take it there to your vault.

In this way we create a fabulously integrable ‘workspace’ with this software, and if we choose to embed CryptPad notes in isolated Obsidian notes, then we are able to interact with the external CryptPad ecosystem remotely and highly efficiently. The iframes that can be used here are exactly the same as the ones we explored previously, and you can very easily get something like the following:

---

[![CryptPad iframe in Obsidian](https://forum.obsidian.md/uploads/default/optimized/3X/4/0/40cf4892786c9c9fc02b9d758bcfdc327ba73646_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/4/0/40cf4892786c9c9fc02b9d758bcfdc327ba73646.png "CryptPad iframe in Obsidian")

---

[![Interacting with CryptPad. Fig. 2](https://forum.obsidian.md/uploads/default/optimized/3X/3/f/3f0768d12b5eadf6b46ba8b75ac121ae3235edfb_2_10x10.png)](https://forum.obsidian.md/uploads/default/original/3X/3/f/3f0768d12b5eadf6b46ba8b75ac121ae3235edfb.png "Interacting with CryptPad. Fig. 2")

---

I have made this last spreadsheet public and it can be reviewed by embedding the following iframe in an isolated Obsidian note:

```
<iframe src="https://cryptpad.fr/sheet/#/2/sheet/view/wpMdCMdu8zQaQrwpVYGUryuI1ZQPRQNpZLTsByvelpM/" style="position:absolute; top:0; left:0; width:100%; border:none; height:100%;">
```

Permissions are read-only, so you won’t be able to leave comments or participate in chat. Whatever the case; Let’s say I’ve built a nice markdown database with my team over there and now each of us wants to integrate it into our personal Obsidian vaults… all we have to do is download the content and deposit it in our respective vaults. Of course, links between markdown notes will not work within CryptPad, and will need to be formatted correctly for them to work nice when the files are duplicated into Obsidian. For this reason, working with CryptPad from the Obsidian interface is essential when creating a cloud ‘vault’ with other users.

Recommendation: all Obsidian documents that are taken to CryptPad must also be kept in the Obsidian vault. Never delete them from the Obsidian vault unless you want to run the risk of permanently losing them or subjecting them to modification by third parties in the case of granting editing permissions. Documents you wish to share with other users can be copied into CryptPad, and then configured to specify the type of access those users will have. Thus, all the material present in Obsidian can be shared with third parties, for example to create duplicates of notes present in your personal vault on which to work collaboratively and without subjecting your original notes to any type of alteration.

Thus we can share multiple notes to start creating a multi-participant Second Brain among all users capable of access, so that later it is possible to visualize the interconnections between the knowledge bases of the different users, collaboratively creating new documents that will be dynamic, following a working method very similar to that of wikis.

Of course, CryptPad is not the only alternative to carry out this type of work. We also have the possibility of doing it from [EtherPad](https://etherpad.org/), [HackMD](https://hackmd.io/), [CodiMD](https://codimd.web.cern.ch/), integrating Obsidan with VS Code to use the [VS Code Live Share](https://visualstudio.microsoft.com/es/services/live-share/) service, also with [Boost Note](https://boostnote.io/), etc.

I would like to know what you think of this workflow! Also, I sincerely hope that all this will be useful to someone, and that it will induce new and great ideas to implement substantial advances in Obsidian! Open-source collaborative editing will be disruptive for KMSs.

[udracing](https://forum.obsidian.md/u/udracing) Insider

You could also include a text copy of the embedded non-markdown file within a comment block. That way it can be found in a search.

[Nils.Srvd](https://forum.obsidian.md/u/Nils.Srvd)

This is a super idea. I do this with entire papers, it looks like this.

[Drive video](https://drive.google.com/file/d/139Zcfk3_fIQKRPa_Z_JDlx4LBcH6PrE9/preview)

Converting non-markdown files into md files is very handy and I think it’s really worth taking the time. Even if it’s just a few fragments.

1 month later

[Iv3llios](https://forum.obsidian.md/u/Iv3llios) Insider

I cant seem to be getting it to work with Microsoft excel documents (I managed to get a view only embed through generating the code online in onedrive, but can’t seem to create a proper interactive one). Could you share if (and how) you achieved it?

[Nils.Srvd](https://forum.obsidian.md/u/Nils.Srvd)

Hello there. I haven’t used OneDrive in a long time, but this should work the same way for any document hosted in the cloud. Are you sure you granted editing access and not “read only” access for your Excel file in OneDrive?

[Iv3llios](https://forum.obsidian.md/u/Iv3llios) Insider

I believe so, but I will check again then thanks!

7 months later

Hi!

How did you go about converting that pdf to markdown?

Thank you

[jaffa](https://forum.obsidian.md/u/jaffa)

I tried embeding your Cryptpad file and got this Error message from Obsidian: “L’intégration est désactivé pour cette application Cryptpad” translating to: “Intégration is deactivated for this application Cryptpad”.

Do you have any idea what might be causing this.  
Thanks

11 months later

2 months later

[Matterhorn5](https://forum.obsidian.md/u/Matterhorn5)

HI, for me the embeddin is working, however the window size is extremely small, so it seems liike the allowfullscreen option is not working as intended. Any fixes?

  

[Powered by Discourse](https://discourse.org/powered-by)