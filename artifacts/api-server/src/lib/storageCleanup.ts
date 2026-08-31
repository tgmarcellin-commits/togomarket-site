type ListingStorageReference = {
  images: string[] | null;
};

type AdStorageReference = {
  image: string | null;
  videoPath: string | null;
};

type VendorStorageReference = {
  profilePhoto: string | null;
};

type MessageStorageReference = {
  fileUrl: string | null;
};

type ServiceStorageReference = {
  image: string | null;
  videoPath: string | null;
};

type EventStorageReference = {
  flyerImage: string | null;
  videoPath: string | null;
};

function addObjectPath(paths: Set<string>, value: string | null | undefined): void {
  const normalized = value?.startsWith("v:") ? value.slice(2) : value;
  if (normalized?.startsWith("/objects/")) {
    paths.add(normalized);
  }
}

export function collectReferencedObjectPaths({
  listings,
  ads,
  vendors,
  messages,
  services,
  events,
}: {
  listings: ListingStorageReference[];
  ads: AdStorageReference[];
  vendors: VendorStorageReference[];
  messages: MessageStorageReference[];
  services: ServiceStorageReference[];
  events: EventStorageReference[];
}): Set<string> {
  const paths = new Set<string>();

  for (const listing of listings) {
    for (const image of listing.images ?? []) {
      addObjectPath(paths, image);
    }
  }

  for (const ad of ads) {
    addObjectPath(paths, ad.image);
    addObjectPath(paths, ad.videoPath);
  }

  for (const vendor of vendors) {
    addObjectPath(paths, vendor.profilePhoto);
  }

  for (const message of messages) {
    addObjectPath(paths, message.fileUrl);
  }

  for (const service of services) {
    addObjectPath(paths, service.image);
    addObjectPath(paths, service.videoPath);
  }

  for (const event of events) {
    addObjectPath(paths, event.flyerImage);
    addObjectPath(paths, event.videoPath);
  }

  return paths;
}
