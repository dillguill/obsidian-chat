---
type: lesson
topics:
  - "[[Module 6 - Storage]]"
tags: []
order: 1
status: 80 Review
sections:
  - 4. File Storage
---
**In this lesson, you will learn how to do the following:**

- Describe Amazon EFS, including its benefits and use cases.
    
- Describe Amazon EFS storage classes and how they can impact pricing.
    
- Describe the EFS lifecycle policies and how they interact with storage classes.
    

Amazon EFS integrates seamlessly with AWS services and eliminates the need to provision and manage file servers. In this lesson, you will learn more about the practical use cases and benefits of Amazon EFS.

![Amazon Elastic File System (EFS) icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_b1067e6126384b6186702cc5097dc13d_Screenshot-2025-08-16-at-10.01.07-PM.png?expiry=1762473600000&hmac=DySIhQTEFpySO7GUBuUJHuB-ecX0IyAcSWuaR62D72c)

**Amazon Elastic File System (EFS)**

Amazon EFS is a fully managed, scalable file storage service for use with AWS cloud services and on-premises resources. It operates using the Linux Network File System (NFS) protocol, and automatically scales to petabytes as you add or remove files without disrupting applications. EFS is designed to support a wide variety of workloads and can be accessed by multiple EC2 instances simultaneously.

## **Amazon EFS benefits**

**Multi-AZ redundancy**

Amazon EFS automatically replicates data across multiple Availability Zones in a region for high availability. This built-in redundancy protects against AZ failures and provides continuous access to your file systems.

![location icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_d03efe940d264ef0b31878048c0cb65c_hANwrFVw-FHs6pka.png?expiry=1762473600000&hmac=aN82R0OYOdOAwrLknl0SlLzP910DrGkCe2AawKdb1FY)

**Shared Access**

Amazon EFS supports thousands of concurrent NFS connections, so multiple EC2 instances can access the same file system simultaneously. This shared access model makes EFS ideal for collaborative workloads and distributed applications.

![EC2 connected to storage](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_cfac6cf04c314254a579eba93a8e6ab2_5W58EIsk0YMZQXwc.png?expiry=1762473600000&hmac=fTbe-YpquaxdvYhQ-kcWsnNNpS-m0u-TCI3ZKzrDhXs)

**Elastic Storage**

Amazon EFS automatically grows and shrinks as you add and remove files, with no need to provision or manage storage capacity. And since you only pay for the storage you use, it's cost-effective for varying workload demands.

![storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_9f086a9baf024af1a9ff330c08e6acef_D02g26EHaYzZWN7z.png?expiry=1762473600000&hmac=64cT_wCCSkuopKm_ke8wTUYRvQDY7J6X5tUVkpAYf2s)

**Amazon EFS storage classes**

With Amazon EFS, you can create and configure file systems quickly without any minimum fee or setup cost. You pay only for the storage used and you can choose from a range of storage classes designed to fit your use case.

To learn more about the Amazon EFS storage classes, review each of the following three storage classes.

**Standard Storage Classes**

The EFS Standard and EFS Standard-Infrequent Access (Standard-IA) storage classes offer Multi-AZ resilience and the highest levels of durability and availability. They have a higher cost associated with them due to higher availability and durability.

![files icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_0b166519a4d348f89379ecc5bc8e7169_RUMR37ZNv1rLPFsj.png?expiry=1762473600000&hmac=UHAGsr5MFLfSDfNIkGpmrdH52xPG2N8kv1E-vnI7lR4)

**One Zone Storage Classes**

The EFS One Zone and EFS One Zone-Infrequent Access (EFS One Zone-IA) provide additional savings by saving your data in a single Availability Zone. By using just one Availability Zone, you can reduce your storage costs when compared to the Standard EFS storage classes.

![files with a location point icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_720ee9ac64ff4a7bb63e15b6b409c55b_Khi4lkTE-vQ-kjWK.png?expiry=1762473600000&hmac=CA-OXjIbn56ZbOlNPhJTQAB4HSgWNlARlvLIK1JQFic)

**Archive Storage Classes**

The EFS Archive storage class is cost-optimized for data that is accessed only a few times a year or less and that does not need the sub-millisecond latencies of EFS Standard. EFS Archive offers a storage price up to 50% lower compared to EFS Infrequent Access, providing a more cost-optimized experience for cold, rarely-accessed data.

![file storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_60edd5e67f534772a8e6ccc69f0b1e5d_GtN3GAKRUkJ1NUYn.png?expiry=1762473600000&hmac=CIdlR1KnEO8ID85MKYWhsrP3w7-Bys9I4j8zK1J3iTo)

**Amazon EFS data lifecycle**

You can further optimize Amazon EFS storage costs by automatically moving data between storage classes based on usage patterns. You can create lifecycle policies that determine when and how files transition between different storage tiers. These automated policies help ensure your data resides in the most cost-effective storage class without manual intervention.

#### Transition to IA

- This policy instructs lifecycle management when to move files into the Infrequent Access storage, which is cost-optimized for data that is accessed only a few times each quarter. By default, files that are not accessed in Standard storage for 30 days are transitioned into IA.
    

![files for storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_8b4d85a534074a0ea998f22a24451af9_GVHamYKyM6YdGS6a.png?expiry=1762473600000&hmac=CrLBd_9GzpaG1nMjccSolD1mIKdMPRMkshYMB3yhkCY)

#### Transition to Archive

- This policy instructs lifecycle management when to move files into the Archive storage class, which is cost-optimized for data that is accessed only a few times each year or less. By default, files that are not accessed in Standard storage for 90 days are transitioned into Archive.
    

![files to storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_8874c438e7104037ab290a4d49c39c27_GcOfSHOZsnsHChUu.png?expiry=1762473600000&hmac=DgMTw2isSuAqfgPkyIsSwJIZdF8kdt-ZenHxI11ZMMI)

#### Transition to Standard

- This policy instructs lifecycle management whether to transition files out of IA or Archive and back into Standard storage when the files are accessed in the IA or Archive storage. By default, files are not moved back to Standard storage, and they remain in the IA or Archive storage class when they are accessed.
    

![multiple folders connected to a file storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/_5e80e89597d8401686e070cac487f3a4_B30xvPJnb_KOK8mz.png?expiry=1762473600000&hmac=dfBelJpqNh5pENhQC6iRjuIxMmDpBmkK6sP5a5lS7kk)