---
type: lesson
topics:
  - "[[Module 10 - Monitoring, Compliance, and Governance in the AWS Cloud]]"
tags: []
order: 3
status: 80 Review
sections:
  - 2. Monitoring and Compliance Services
---
**In this lesson, you will learn how to do the following:**

- Describe why auditing is important.
    
- Describe benefits and use cases of AWS CloudTrail.
    
- Describe CloudTrail events, logs, and insights.
    

In this lesson, you will learn about the AWS CloudTrail service and how it can be used in auditing your resources.

**Importance of auditing**

Imagine a financial company with a hybrid cloud solution trying to figure out what happened when there are changes made to their resources in the cloud and on premises. They need this information for troubleshooting and to provide detailed records for compliance. That's where CloudTrail can help.

![person asking: "what happened? who did this? and when?"](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/29ded394-2fc4-428b-b130-45597e43088d_42b35043d9f9439da3aa1ae0891c13ba_xLngS4ZeKjlPLob5.png?expiry=1763329685747&hmac=2U4ikhwipI6Do_nHwgiHp3Tu1g3lYWVoI6Fx_yKiKfY)

![AWS CloudTrail icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/14c0a15c-3d45-41d7-8c31-aaac8b28a467_08ba0b183795482d9a7d9b643168091f_1OCJKv-CNdsEGlh3.png?expiry=1763329685747&hmac=0TSSEAEJKpC7jThPsLMVOyBf-0cG1AjWaeJJvAtx4OU)

**AWS CloudTrail**

CloudTrail tracks user activity and API usage in the AWS Cloud, on premises, and even with other cloud providers. CloudTrail provides a detailed history of API calls, so you can track changes and identify who made them and when. This helps you understand what actions were taken on your AWS resources.

**Benefits:** CloudTrail provides auditing, security monitoring, and operational troubleshooting. It also helps you prove compliance and improve your security posture.

**Use cases:** It can be used for compliance and auditing, identifying security incidents, troubleshooting operational issues.

To learn more about CloudTrail features, review each of the following three categories.

**CloudTrail events**

CloudTrail events capture details about actions performed within your AWS account, such as API calls, console actions, or other activities. Event history provides a viewable, searchable, downloadable, and immutable record of the past 90 days of management events in an AWS Region. There are no CloudTrail charges for viewing event history.

![bell with text events](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/69d51d39-c461-42b4-a165-b5264b34b05b_22a7d2a530f24cd5ae2ffcca02eb3279_JEfknA2lOTE_01wh.png?expiry=1763329685747&hmac=2lplpGeS2sayxxTDMBKT3Q3exGPpsI4FqAt3cvU-KXs)

**CloudTrail logs**

CloudTrail monitors events and delivers those events as log files to your Amazon Simple Storage Service (Amazon S3) bucket. Because CloudTrail logs are securely stored, they can be used to prove compliance with regulations such as Payment Card Industry (PCI) and Healthcare Insurance Portability and Accountability Act (HIPAA).

![checklist with text logs](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/868d1b5e-e59b-48df-b603-2fc2f7e50bf8_30225813eb9a45dcbae068791d82f472__qohlirNmmEl8UYY.png?expiry=1763329685747&hmac=KOcc9PWL8wl-uuaDt4ROrHZ8Oq26vAgeB4fYHGDmI5M)

**CloudTrail Insights**

CloudTrail Insights analyzes your normal patterns of API call volume and API error rates. CloudTrail Insights also generates Insights events when API call volumes and error rates deviate from these normal patterns. You can enable CloudTrail Insights in your trails or event data stores to detect anomalous behavior and unusual activity.

![charts with text insights](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/a74dbb27-291a-41b3-84e4-e10c8f687141_e43d26ae8b404d5fb03c9fb160e0c6d4_M2kPcHxfq8x51EQN.png?expiry=1763329685747&hmac=tyh7vXKgTnspzZhFEbevEi36LMeQSQVDYfoURLatGlM)