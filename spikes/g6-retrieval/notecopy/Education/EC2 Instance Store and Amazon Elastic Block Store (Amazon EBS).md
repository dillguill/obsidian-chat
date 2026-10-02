---
type: lesson
topics:
  - "[[Module 6 - Storage]]"
tags: []
order: 1
status: 80 Review
sections:
  - 2. Block Storage
---
**In this lesson, you will learn how to do the following:**

- Describe Amazon EC2 instance store, including its benefits and use cases.
    
- Describe Amazon EBS, including its benefits and use cases.
    

AWS offers two types of block storage: Amazon EC2 instance store and Amazon Elastic Block Store, or Amazon EBS. In this lesson, you will learn about the different use cases and benefits for Amazon EC2 instance store and Amazon EBS.

![Amazon EC2 instance store icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/2798665e-c5b0-4a01-a400-6496750408f8_7be59b63ebf540fe9cf2b7e3114d67bf_Zk7NRjDVp20mfAMM.svg?expiry=1762473600000&hmac=0gTJlz6zuCu2qpA3pkrqlfpMM-Zi9J-YJ3Wb05J_9Ko)

**Amazon EC2 instance store**

Amazon EC2 instance store isn't a stand-alone AWS block storage service. Rather, it refers to the block-level storage that is physically attached to the EC2 instance host computer. Depending on the type of instance, EC2 instance store might come attached as the default storage. Since its data is lost when an instance is stopped or terminated, EC2 instance store is best for temporary memory-based storage needs like buffers, caches, and scratch data. It is not recommended for applications that require data retention.

**Key takeaway: no data persistence**

An Amazon EC2 instance store provides temporary block-level storage for an Amazon EC2 instance. This means that if you stop or terminate an Amazon EC2 instance, all the data written to the attached instance store is deleted.

To learn how Amazon EC2 instance store manages data when an EC2 instance is stopped, choose each of the following three numbered markers.

![EC2 instance store with and without data](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/19c0d1b7-f74d-4afc-bc07-568c9c54d365_391667016b5d4bb98f7bcf0ff1f2ebae_VA6_de1NWwU83Giy.png?expiry=1762473600000&hmac=eUM-FYGaWsd_Z-liz195wy46UWq3GEUCIQgGiFLAhfE)

## **Benefits**

**Automatically available storage**

Instance store volumes come automatically attached to many EC2 instance types, providing temporary block-level storage at no additional cost. It's physically connected to the host computer, offering high I/O performance for data that disappears when the instance stops.

![EC2 instance icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/040e50bb-6b81-47be-94eb-cffe45843a4c_e78867e1e5b440d9a0c08e03735c8e2e_AgdMJGUPgh0Ild1o.png?expiry=1762473600000&hmac=rr09yMmoIuEW5pnroWERuYnl_yD7pvTtHCw5JR7o2UU)

**Cost Effective**

Because EC2 instance store is included in the EC2 instance price, you don't have to pay any additional fees for storage. It's ideal for temporary storage needs like buffers, caches, or scratch data, potentially reducing expenses for applications that don't require persistent storage.

![cash icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/6fcff308-a358-4ef6-a4fb-a74b67f61c74_8d063c4c03684faa9543864ca472982f_V6ulBc4H4cBmiRB0.png?expiry=1762473600000&hmac=7OrJtS-s54eQNVr5V6ujdaKaqAFaCo3VC-kBTPuQexo)

**High Performance**

EC2 instance store offers extremely low-latency storage directly attached to the host server of your EC2 instance. This proximity means exceptionally high I/O performance, making it ideal for temporary storage of data requiring fast processing.

![gear icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/8b3c96b1-f81f-4dd2-9664-e8abded31f01_90d0b5c551a3470eb62a4cebccbed8e6_GMIHIooz1xhyevyd.png?expiry=1762473600000&hmac=hACSNZrtofCsVmKqCW_SHsP-pn03_SPb8z8P-wkfZdw)

![Amazon Elastic Block Store (EBS) icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/d6fe049b-7efd-498e-baf1-7f04a997e7e9_093dda0618c249069d06965a1b06caa5_yAJO0t2nOAVKPTrF.svg?expiry=1762473600000&hmac=qmtT61Un4KHoa7iLjoSBzK78XfHCqdbYHpusT55dsvs)

**Amazon Elastic Block Store (EBS)**

Amazon EBS provides _persistent block-level storage_ volumes for use with Amazon EC2 instances. EBS volumes act like external hard drives, offering consistent and low-latency performance for workloads like databases and file systems.

EBS volumes can be conveniently backed up, resized, and attached to different EC2 instances. To create an EBS volume, you define the configuration for things like volume size and type. After the volume has been created, it can be attached to an Amazon EC2 instance. Because EBS volumes are for data that needs to persist, it’s important to back up the data. It's recommended that you take incremental backups of EBS volumes by creating Amazon EBS snapshots.

**Key takeaway: data persistence**

Amazon EBS provides block-level storage volumes that you can use with Amazon EC2 instances. If you stop or terminate an Amazon EC2 instance, all the data on the attached EBS volume remains available.

To learn how Amazon EBS manages data when an EC2 instance is stopped, review each of the following three instances.

![EBS volume with and without data](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/d7753ec8-f187-42ce-ac7f-5b2e475a6208_4c3ac4c875774d05b77fd6716b46be94_bMP0pM_ayJUnyx3I.png?expiry=1762473600000&hmac=ywVCL3QgOxRPT7AW1S-t33w2AzRq-wcye4K78haBYcI)

## Step 1

An EC2 instance is running with data being stored in an attached EBS volume.

## Step 2

The EC2 instance is stopped.

## Step 3

After the EC2 instance is stopped or terminated, all data stored within the EBS volume is retained.

**Use cases**

Some practical use cases of Amazon EBS include database hosting, backup storage for applications, and rapid deployment of development environments using volume snapshots.

**Benefits**

EBS volumes support data portability through their ability to detach and reattach to instances as needed. There are many practical reasons you might choose to do this.

**Data Migration**

EBS volumes can be easily migrated between Availability Zones using snapshots. The snapshots provide a simple way to move data across regions or create copies.

![cloud storage icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/d979a6da-9522-45f1-97af-e0466e18f92e_90f8d09b0d284059a391ce350fc1a85d_N1lnbQVhsH6V88q5.png?expiry=1762473600000&hmac=bFCg9s49gsfkb8Mek6GuXXMncNOpn2dn641YO1qohfY)

**Instance type changes**

Since EBS volumes remain independent of EC2 instances, it's not complicated to attach them to different instance types. This flexibility lets you upgrade or downgrade instances without losing data.

![ec2 icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/28b0ac35-54a7-4fb0-ab25-cc23ee618ffd_373e2152d36a452db130231e120e7933_Ro1Uk3qg7NXp0Gz0.png?expiry=1762473600000&hmac=Fytz2pG3BKaeegZx5C63hOTbV2wDpi1Jxr4TRxA8NHA)

**Disaster recovery**

EBS snapshots provide reliable backup solutions that can be restored in different regions during emergencies. Regular automated snapshots ensure your data remains protected and quickly recoverable.

![warning icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/a9950ccf-6dc1-4454-a3e2-cca0c8c8e35e_0d4488c006434b97bd63f39396c3a51e_y-ZCkeDMTqzjBlys.png?expiry=1762473600000&hmac=0MmwKyb7Z7JKICQysS_vj7j2qMw7tmHJbyQPmLJSojw)

**Cost Optimization**

EBS volumes can be modified to different types and sizes to match actual usage patterns. You can switch between storage types or adjust capacity without downtime.

![money bag icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/fb930e6a-93a7-4d95-ad70-7c318f17f21c_c49b9e39594c4743978ce9b5cde6dcf1_d50fOco-8HgKu_yy.png?expiry=1762473600000&hmac=KEEzPfJGg36fn9-KvCdw2XahqBsX-f0BkT-PdmO8aUM)

**Performance tuning**

Amazon EBS offers various volume types to match different workload requirements and IOPS needs. You can adjust volume performance characteristics on the fly to meet changing application demands.

![gears icon](https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/71b14615-89d5-4a04-99ec-1da13523389a_d56fe4c35870441a8795489f345e47b8_tzxZfmaTLw22QmCY.png?expiry=1762473600000&hmac=VVt8pouRVp802FUtCkR8Ig3s82Q12Rrrq-58a5Pqb1w)