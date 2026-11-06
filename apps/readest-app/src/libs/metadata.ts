import { MetadataResult, SearchRequest } from '@/services/metadata/types';
import { MetadataService } from '@/services/metadata/service';

const metadataService = new MetadataService();

export const searchMetadata = async (request: SearchRequest): Promise<MetadataResult[]> => {
  return metadataService.search(request);
};
